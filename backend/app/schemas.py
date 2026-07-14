from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

class InteractionSchema(BaseModel):
    hcp_name: Optional[str] = Field(None, description="Name of the Healthcare Professional")
    product: Optional[str] = Field(None, description="The pharmaceutical product or drug discussed")
    summary: Optional[str] = Field(None, description="Summary of the interaction details and discussion points")
    interaction_type: Optional[str] = Field("Meeting", description="Type of interaction, e.g., Meeting, Email, Phone Call")
    date: Optional[str] = Field(None, description="Date of the interaction (DD-MM-YYYY format or description)")
    time: Optional[str] = Field(None, description="Time of the interaction (HH:MM format)")
    attendees: Optional[List[str]] = Field(default_factory=list, description="Names of attendees who participated")
    topics_discussed: Optional[str] = Field(None, description="Detailed topics and points discussed (additional detail)")
    materials_shared: Optional[List[str]] = Field(default_factory=list, description="List of documents or marketing materials shared")
    samples_distributed: Optional[List[str]] = Field(default_factory=list, description="List of pharmaceutical samples distributed")
    sentiment: Optional[str] = Field("Neutral", description="Sentiment of the HCP (Positive, Neutral, Negative)")
    outcomes: Optional[str] = Field(None, description="Key outcomes or agreements reached")
    followup_actions: Optional[str] = Field(None, description="Agreed next steps or follow-up actions")

class ChatMessage(BaseModel):
    sender: str = Field(..., description="Either 'user' or 'assistant'")
    text: str = Field(..., description="Content of the message")

class ChatRequest(BaseModel):
    text: str = Field(..., description="The user input describing interaction details or answering a follow-up question")
    chat_history: List[ChatMessage] = Field(default_factory=list, description="The ongoing chat history")
    current_form_data: Optional[InteractionSchema] = Field(None, description="The current state of the structured form data")

class ChatResponse(BaseModel):
    success: bool
    chat_history: List[ChatMessage]
    extracted_data: InteractionSchema
    missing_fields: List[str]
    is_valid: bool
    agent_response: str
    status: str  # 'extracting' | 'validating' | 'generating_followup' | 'saved'
