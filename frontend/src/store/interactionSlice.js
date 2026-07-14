import { createSlice } from '@reduxjs/toolkit';

const initialFormState = {
  hcp_name: '',
  product: '',
  summary: '',
  interaction_type: 'Meeting',
  date: new Date().toISOString().split('T')[0], // Default to current date (YYYY-MM-DD)
  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }), // Default to HH:MM
  attendees: [],
  topics_discussed: '',
  materials_shared: [],
  samples_distributed: [],
  sentiment: 'Neutral',
  outcomes: '',
  followup_actions: '',
};

const initialState = {
  formData: { ...initialFormState },
  chatHistory: [
    {
      sender: 'assistant',
      text: 'Hello! I can help you log your HCP interaction details quickly. You can type details like: "Met Dr. Smith today to discuss OncoBoost efficacy. The doctor showed high interest, and I left two sample packs of OncoBoost." or ask me questions.'
    }
  ],
  isLoading: false,
  error: null,
};

export const interactionSlice = createSlice({
  name: 'interaction',
  initialState,
  reducers: {
    updateFormField: (state, action) => {
      const { field, value } = action.payload;
      state.formData[field] = value;
    },
    setFullFormData: (state, action) => {
      state.formData = {
        ...state.formData,
        ...action.payload,
      };
    },
    addChatMessage: (state, action) => {
      state.chatHistory.push(action.payload);
    },
    setChatHistory: (state, action) => {
      state.chatHistory = action.payload;
    },
    setLoading: (state, action) => {
      state.isLoading = action.payload;
    },
    setError: (state, action) => {
      state.error = action.payload;
    },
    resetForm: (state) => {
      state.formData = { 
        ...initialFormState,
        date: new Date().toISOString().split('T')[0],
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      };
      state.error = null;
    },
    clearChat: (state) => {
      state.chatHistory = [initialState.chatHistory[0]];
      state.error = null;
    }
  }
});

export const {
  updateFormField,
  setFullFormData,
  addChatMessage,
  setChatHistory,
  setLoading,
  setError,
  resetForm,
  clearChat
} = interactionSlice.actions;

export default interactionSlice.reducer;
