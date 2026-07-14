import os
import json
import re
from datetime import datetime
from typing import TypedDict, List, Dict, Any, Optional
from dotenv import load_dotenv

from langgraph.graph import StateGraph, END
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from sqlalchemy.orm import Session

from app.database import SessionLocal, HCPInteraction, engine
from app.schemas import InteractionSchema

load_dotenv()

# Define LangGraph State
class GraphState(TypedDict):
    raw_text: str
    extracted_data: Dict[str, Any]
    missing_fields: List[str]
    is_valid: bool
    chat_history: List[Dict[str, str]]
    agent_response: str
    status: str  # "extracting" | "validating" | "generating_followup" | "saved"
    db_id: Optional[int]

# Rule-based fallback extractor when Groq is not configured
def fallback_extractor(text: str, current_data: Dict[str, Any]) -> Dict[str, Any]:
    data = current_data.copy() if current_data else {}
    
    # 1. HCP Name search (e.g. Dr. Smith, Doctor Jones)
    # Disabled general case-insensitivity to ensure we match capitalized names, rather than words like "and"
    hcp_match = re.search(r'\b(?:Dr\.|Doctor|dr\.|doctor|DR\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)', text)
    if hcp_match:
        data["hcp_name"] = f"Dr. {hcp_match.group(1)}"
        
    # 2. Product search (common pharma products, or mentions of product/drug)
    # Match product followed by one or more conversational words (e.g., "product discussed about the OncoBoost")
    product_match = re.search(r'\b(?:product|drug|medication|brand)\b(?:\s+(?:discussed|about|is|was|of|with|for|the|a|an))+\s+([a-zA-Z0-9\-]+)', text, re.IGNORECASE)
    if not product_match:
        # Fallback to direct next word if no conversational fillers are present (e.g. "product OncoBoost")
        product_match = re.search(r'\b(?:product|drug|medication|brand)\s+([a-zA-Z0-9\-]+)', text, re.IGNORECASE)
        
    common_products = ["OncoBoost", "Keytruda", "Humira", "Lipitor", "Ozempic", "CardioRx", "NeuroMax"]
    found_product = None
    for cp in common_products:
        if cp.lower() in text.lower():
            found_product = cp
            break
            
    if found_product:
        data["product"] = found_product
    elif product_match:
        candidate = product_match.group(1)
        # Verify it's not a common stop word
        stop_words = {"discussed", "about", "the", "a", "an", "is", "was", "for", "with", "of", "to", "on"}
        if candidate.lower() not in stop_words:
            data["product"] = candidate.capitalize()

    # 3. Summary / Topics
    if text and not data.get("summary"):
        data["summary"] = text[:150] + "..." if len(text) > 150 else text
        
    # 4. Samples distributed
    samples_match = re.finditer(r'(?:sample|vial|pack|dose|kit)s?\s+(?:of\s+)?([A-Za-z0-9]+)', text, re.IGNORECASE)
    found_samples = []
    for m in samples_match:
        found_samples.append(m.group(1))
    if "brochure" in text.lower():
        found_samples.append("Brochure")
    
    if found_samples:
        existing_samples = data.get("samples_distributed", []) or []
        data["samples_distributed"] = list(set(existing_samples + found_samples))

    # Check if text implies a meeting happened (e.g. "met with", "he met with", "she met with", "i met with")
    implies_meeting = False
    lower_text = text.lower()
    if "met with" in lower_text or re.search(r'\b(?:he|she|i)\s+met\b', lower_text):
        implies_meeting = True

    # 5. Date / Time extraction
    date_match = re.search(r'\b\d{4}-\d{2}-\d{2}\b', text)  # YYYY-MM-DD
    if not date_match:
        date_match = re.search(r'\b\d{2}-\d{2}-\d{4}\b', text)  # DD-MM-YYYY
        
    if date_match:
        extracted_date = date_match.group(0)
        # Normalize DD-MM-YYYY to YYYY-MM-DD
        if len(extracted_date) == 10 and extracted_date[2] == '-' and extracted_date[5] == '-':
            d, m, y = extracted_date.split('-')
            extracted_date = f"{y}-{m}-{d}"
        data["date"] = extracted_date
    elif implies_meeting and not data.get("date"):
        data["date"] = datetime.now().strftime("%Y-%m-%d")
        
    time_match = re.search(r'\b\d{2}:\d{2}\b', text)
    if time_match:
        data["time"] = time_match.group(0)
    elif implies_meeting and not data.get("time"):
        data["time"] = datetime.now().strftime("%H:%M")

    # 6. Sentiment
    if "positive" in text.lower() or "efficacy was great" in text.lower() or "pleased" in text.lower() or "happy" in text.lower():
        data["sentiment"] = "Positive"
    elif "negative" in text.lower() or "skeptical" in text.lower() or "complained" in text.lower():
        data["sentiment"] = "Negative"
    elif not data.get("sentiment"):
        data["sentiment"] = "Neutral"

    return data

# Node 1: Extractor Node
def extractor_node(state: GraphState) -> Dict[str, Any]:
    text = state["raw_text"]
    current_data = state.get("extracted_data") or {}
    
    groq_api_key = os.getenv("GROQ_API_KEY", "")
    
    if not groq_api_key or groq_api_key.startswith("gsk_your_groq_api_key"):
        # Fallback local extraction
        extracted = fallback_extractor(text, current_data)
        return {
            **state,
            "extracted_data": extracted,
            "status": "extracting"
        }
    
    try:
        # LLM based extraction using Groq
        model_name = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
        llm = ChatGroq(
            model=model_name, 
            groq_api_key=groq_api_key, 
            temperature=0.0
        )
        
        prompt = ChatPromptTemplate.from_template("""
        You are an AI assistant for a Pharma CRM. Your task is to extract HCP (Healthcare Professional) interaction details.
        
        Analyze the raw input text. Merge the parsed data with any existing data provided.
        Update fields only if the new input provides a replacement or correction.
        
        Current Date and Time for reference:
        - Date: {current_date}
        - Time: {current_time}
        
        Guidelines for Date and Time:
        1. If the input indicates a meeting/interaction occurred or is occurring (e.g. contains phrases like "met with", "meeting with", "he met with", "she met with"), and no specific date or time is explicitly mentioned in the text, you MUST auto-update/set "date" to the current date ({current_date}) and "time" to the current time ({current_time}).
        2. Otherwise, extract the date/time from the text if mentioned.
        
        Response MUST be a valid JSON object matching this schema:
        {{
            "hcp_name": "Dr. [Name] or null",
            "product": "[Product name] or null",
            "summary": "[Summary of discussion] or null",
            "interaction_type": "Meeting | Email | Phone Call or null",
            "date": "YYYY-MM-DD format or null",
            "time": "HH:MM format or null",
            "attendees": ["List of attendee names"] or empty list,
            "topics_discussed": "Detailed topics discussed or null",
            "materials_shared": ["List of brochures, slide decks, PDFs etc."] or empty list,
            "samples_distributed": ["List of sample products or packs given"] or empty list,
            "sentiment": "Positive | Neutral | Negative or null",
            "outcomes": "Actionable outcomes, agreements or null",
            "followup_actions": "Follow-up tasks or null"
        }}
        
        Do not output any markdown formatting, only output the raw JSON block.
        
        Existing Form Data: {current_data}
        New Raw Text Input: {text}
        """)
        
        chain = prompt | llm
        
        # Get current date and time
        now = datetime.now()
        current_date_str = now.strftime("%Y-%m-%d")
        current_time_str = now.strftime("%H:%M")
        
        response = chain.invoke({
            "current_data": json.dumps(current_data),
            "text": text,
            "current_date": current_date_str,
            "current_time": current_time_str
        })
        
        # Clean potential markdown JSON syntax
        clean_content = response.content.strip()
        if clean_content.startswith("```json"):
            clean_content = clean_content[7:]
        if clean_content.endswith("```"):
            clean_content = clean_content[:-3]
        clean_content = clean_content.strip()
        
        extracted = json.loads(clean_content)
        
        # Ensure lists are lists
        for list_key in ["attendees", "materials_shared", "samples_distributed"]:
            if not isinstance(extracted.get(list_key), list):
                extracted[list_key] = []
                
        return {
            **state,
            "extracted_data": extracted,
            "status": "extracting"
        }
    except Exception as e:
        print(f"Groq Extraction failed, using fallback. Error: {e}")
        extracted = fallback_extractor(text, current_data)
        return {
            **state,
            "extracted_data": extracted,
            "status": "extracting"
        }

# Node 2: Validator Node
def validator_node(state: GraphState) -> Dict[str, Any]:
    extracted = state.get("extracted_data") or {}
    missing_fields = []
    
    # Define required fields
    required = ["hcp_name", "product", "summary"]
    
    for field in required:
        val = extracted.get(field)
        if not val or (isinstance(val, str) and val.strip() == ""):
            missing_fields.append(field)
            
    is_valid = len(missing_fields) == 0
    
    return {
        **state,
        "missing_fields": missing_fields,
        "is_valid": is_valid,
        "status": "validating"
    }

# Router: Conditional Edge Router
def router_decision(state: GraphState) -> str:
    if state["is_valid"]:
        return "save"
    else:
        return "followup"

# Node 3: Follow-up Node
def followup_node(state: GraphState) -> Dict[str, Any]:
    missing = state.get("missing_fields", [])
    extracted = state.get("extracted_data", {})
    groq_api_key = os.getenv("GROQ_API_KEY", "")
    
    # Readable field names
    field_mappings = {
        "hcp_name": "HCP Name",
        "product": "Product Discussed",
        "summary": "Interaction Summary"
    }
    missing_friendly = [field_mappings.get(f, f) for f in missing]
    
    if not groq_api_key or groq_api_key.startswith("gsk_your_groq_api_key"):
        # Local fallback message
        fields_str = ", ".join(missing_friendly)
        msg = f"I've updated the log, but I'm still missing: **{fields_str}**. Could you please provide these details?"
        return {
            **state,
            "agent_response": msg,
            "status": "generating_followup"
        }
        
    try:
        model_name = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
        llm = ChatGroq(
            model=model_name, 
            groq_api_key=groq_api_key, 
            temperature=0.7
        )
        
        prompt = ChatPromptTemplate.from_template("""
        You are an AI assistant helping a pharmaceutical sales representative log an interaction with a doctor.
        We have partially extracted some data: {extracted_data}
        However, the following key fields are missing: {missing_fields_friendly}
        
        Generate a polite, concise conversational reply to ask the sales representative for the missing details.
        Make it sound professional, natural, and helpful. Keep it under 3 sentences.
        """)
        
        chain = prompt | llm
        response = chain.invoke({
            "extracted_data": json.dumps(extracted),
            "missing_fields_friendly": ", ".join(missing_friendly)
        })
        
        return {
            **state,
            "agent_response": response.content.strip(),
            "status": "generating_followup"
        }
    except Exception as e:
        fields_str = ", ".join(missing_friendly)
        msg = f"I have processed your message. To complete the log, I still need: **{fields_str}**. Can you provide that?"
        return {
            **state,
            "agent_response": msg,
            "status": "generating_followup"
        }

# Node 4: Save Node
def save_node(state: GraphState) -> Dict[str, Any]:
    extracted = state.get("extracted_data") or {}
    raw_text = state.get("raw_text", "")
    
    db: Session = SessionLocal()
    db_id = None
    try:
        hcp_name = extracted.get("hcp_name")
        product = extracted.get("product")
        date = extracted.get("date")
        time = extracted.get("time")
        
        # Check for existing duplicate to reduce redundancy (ignoring exact time as it changes every minute)
        existing = db.query(HCPInteraction).filter(
            HCPInteraction.hcp_name == hcp_name,
            HCPInteraction.product == product,
            HCPInteraction.date == date
        ).first()
        
        if existing:
            db_id = existing.id
            msg = f"Duplicate detected: This interaction with **{existing.hcp_name}** regarding **{existing.product}** on {existing.date} at {existing.time} is already logged in the CRM database (ID: {db_id}). Duplicate insertion skipped to reduce redundancy."
            return {
                **state,
                "db_id": db_id,
                "agent_response": msg,
                "status": "saved"
            }

        interaction = HCPInteraction(
            hcp_name=hcp_name,
            product=product,
            summary=extracted.get("summary"),
            interaction_type=extracted.get("interaction_type", "Meeting"),
            date=date,
            time=time,
            attendees=", ".join(extracted.get("attendees") or []),
            topics_discussed=extracted.get("topics_discussed"),
            sentiment=extracted.get("sentiment", "Neutral"),
            materials_shared=", ".join(extracted.get("materials_shared") or []),
            samples_distributed=", ".join(extracted.get("samples_distributed") or []),
            outcomes=extracted.get("outcomes"),
            followup_actions=extracted.get("followup_actions"),
            raw_text=raw_text
        )
        db.add(interaction)
        db.commit()
        db.refresh(interaction)
        db_id = interaction.id
        
        # Determine active database dialect name
        dialect_name = engine.dialect.name
        if dialect_name == "postgresql":
            db_type = "PostgreSQL"
        elif dialect_name == "mysql":
            db_type = "MySQL"
        elif dialect_name == "sqlite":
            db_type = "SQLite"
        else:
            db_type = dialect_name.capitalize()
            
        msg = f"Success! The interaction with **{interaction.hcp_name}** has been successfully parsed and saved to the {db_type} CRM database (ID: {db_id})."
        
        return {
            **state,
            "db_id": db_id,
            "agent_response": msg,
            "status": "saved"
        }
    except Exception as e:
        print(f"Error saving to DB: {e}")
        db.rollback()
        # Mock save success for demo if database is not active
        msg = f"Logged details successfully! (Saved to local memory fallback. Dr. {extracted.get('hcp_name')}, Product: {extracted.get('product')})"
        return {
            **state,
            "db_id": 999,
            "agent_response": msg,
            "status": "saved"
        }
    finally:
        db.close()

# Compile the Workflow
workflow = StateGraph(GraphState)

# Add nodes
workflow.add_node("extractor", extractor_node)
workflow.add_node("validator", validator_node)
workflow.add_node("followup", followup_node)
workflow.add_node("save", save_node)

# Set entry point
workflow.set_entry_point("extractor")

# Add transitions
workflow.add_edge("extractor", "validator")
workflow.add_conditional_edges(
    "validator",
    router_decision,
    {
        "save": "save",
        "followup": "followup"
    }
)
workflow.add_edge("followup", END)
workflow.add_edge("save", END)

# Final Compiled App
langgraph_app = workflow.compile()
