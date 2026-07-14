import os
import sys
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from dotenv import load_dotenv

# Allow running directly as `python app/main.py`
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.database import init_db, get_db, HCPInteraction
from app.schemas import ChatRequest, ChatResponse, ChatMessage, InteractionSchema
from app.workflow import langgraph_app

load_dotenv()

# Lifespan context manager for startup and shutdown events
@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        init_db()
        print("Database initialized successfully.")
    except Exception as e:
        print(f"Database initialization failed: {e}")
    yield

# Initialize FastAPI App
app = FastAPI(
    title="Pharma CRM HCP Interaction API",
    description="FastAPI Backend for LangGraph powered HCP Interaction logging",
    version="1.0.0",
    lifespan=lifespan
)

# Set up CORS middleware to allow connection from the React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this to the frontend URL
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Pharma CRM HCP Interaction API is active."}

@app.post("/api/interaction/chat", response_model=ChatResponse)
def process_chat_interaction(request: ChatRequest, db: Session = Depends(get_db)):
    try:
        # Convert Request Chat Messages to lists of dicts for LangGraph state
        state_history = []
        for msg in request.chat_history:
            state_history.append({
                "sender": msg.sender,
                "text": msg.text
            })
            
        # Compile existing form data if any
        current_data = {}
        if request.current_form_data:
            current_data = request.current_form_data.dict(exclude_unset=True)
            
        # Initialize graph state
        initial_state = {
            "raw_text": request.text,
            "extracted_data": current_data,
            "chat_history": state_history,
            "missing_fields": [],
            "is_valid": False,
            "agent_response": "",
            "status": "extracting",
            "db_id": None
        }
        
        # Invoke LangGraph Workflow
        result_state = langgraph_app.invoke(initial_state)
        
        # Update Chat History
        updated_history = list(request.chat_history)
        # Add the user message
        updated_history.append(ChatMessage(sender="user", text=request.text))
        # Add the assistant response
        updated_history.append(ChatMessage(sender="assistant", text=result_state["agent_response"]))
        
        # Extract response schema structure
        extracted_fields = result_state.get("extracted_data") or {}
        
        # Handle default list fields if missing
        for list_field in ["attendees", "materials_shared", "samples_distributed"]:
            if list_field not in extracted_fields or extracted_fields[list_field] is None:
                extracted_fields[list_field] = []
                
        # Parse into InteractionSchema
        parsed_extracted_data = InteractionSchema(**extracted_fields)
        
        return ChatResponse(
            success=True,
            chat_history=updated_history,
            extracted_data=parsed_extracted_data,
            missing_fields=result_state.get("missing_fields") or [],
            is_valid=result_state.get("is_valid", False),
            agent_response=result_state.get("agent_response", ""),
            status=result_state.get("status", "extracting")
        )
        
    except Exception as e:
        print(f"Error processing interaction chat: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred while processing the request: {str(e)}"
        )

@app.post("/api/interaction/save")
def save_interaction(request: InteractionSchema, db: Session = Depends(get_db)):
    try:
        # Check for existing duplicate to reduce redundancy (ignoring exact time as it changes every minute)
        existing = db.query(HCPInteraction).filter(
            HCPInteraction.hcp_name == request.hcp_name,
            HCPInteraction.product == request.product,
            HCPInteraction.date == request.date
        ).first()
        
        if existing:
            return {
                "success": True, 
                "db_id": existing.id, 
                "message": f"Duplicate detected: Interaction already exists in the CRM database (ID: {existing.id})."
            }

        interaction = HCPInteraction(
            hcp_name=request.hcp_name,
            product=request.product,
            summary=request.summary,
            interaction_type=request.interaction_type or "Meeting",
            date=request.date,
            time=request.time,
            attendees=", ".join(request.attendees) if request.attendees else "",
            topics_discussed=request.topics_discussed,
            sentiment=request.sentiment or "Neutral",
            materials_shared=", ".join(request.materials_shared) if request.materials_shared else "",
            samples_distributed=", ".join(request.samples_distributed) if request.samples_distributed else "",
            outcomes=request.outcomes,
            followup_actions=request.followup_actions,
            raw_text="Manually logged via structured form."
        )
        db.add(interaction)
        db.commit()
        db.refresh(interaction)
        return {"success": True, "db_id": interaction.id, "message": "Interaction saved successfully."}
    except Exception as e:
        db.rollback()
        print(f"Error saving manual interaction: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred while saving the interaction: {str(e)}"
        )

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "127.0.0.1")
    uvicorn.run("app.main:app", host=host, port=port, reload=True)
