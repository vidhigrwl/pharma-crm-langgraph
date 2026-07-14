import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  updateFormField,
  setFullFormData,
  addChatMessage,
  setChatHistory,
  setLoading,
  setError,
  resetForm,
  clearChat
} from '../store/interactionSlice';
import {
  MessageSquare,
  FileText,
  Columns,
  Send,
  Mic,
  Plus,
  Check,
  Sparkles,
  Clock,
  Calendar,
  User,
  ArrowRight,
  AlertCircle,
  RotateCcw,
  CheckCircle2,
  Bookmark
} from 'lucide-react';

export default function LogInteraction() {
  const dispatch = useDispatch();
  const { formData, chatHistory, isLoading, error } = useSelector((state) => state.interaction);

  const [activeTab, setActiveTab] = useState('split'); // 'form' | 'chat' | 'split'
  const [chatInput, setChatInput] = useState('');
  const [attendeeInput, setAttendeeInput] = useState('');
  const [materialInput, setMaterialInput] = useState('');
  const [sampleInput, setSampleInput] = useState('');
  const [voiceSimulating, setVoiceSimulating] = useState(false); // Used to track if recording
  const [logSuccess, setLogSuccess] = useState(false);
  const [recognition, setRecognition] = useState(null);

  React.useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-US';

      rec.onstart = () => {
        setVoiceSimulating(true);
      };

      rec.onend = () => {
        setVoiceSimulating(false);
      };

      rec.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (transcript.trim()) {
          sendChatMessage(transcript);
        }
      };

      rec.onerror = (event) => {
        console.error("Speech recognition error", event.error);
        setVoiceSimulating(false);
        if (event.error === 'not-allowed') {
          dispatch(setError("Microphone permission denied."));
        } else {
          dispatch(setError(`Voice capture error: ${event.error}`));
        }
      };

      setRecognition(rec);
    }
  }, [dispatch]);

  // Handle direct form field modifications
  const handleFieldChange = (field, value) => {
    dispatch(updateFormField({ field, value }));
  };

  const handleAddAttendee = (e) => {
    e.preventDefault();
    if (attendeeInput.trim()) {
      const updated = [...formData.attendees, attendeeInput.trim()];
      handleFieldChange('attendees', updated);
      setAttendeeInput('');
    }
  };

  const handleRemoveAttendee = (index) => {
    const updated = formData.attendees.filter((_, i) => i !== index);
    handleFieldChange('attendees', updated);
  };

  const handleAddMaterial = (e) => {
    e.preventDefault();
    if (materialInput.trim()) {
      const updated = [...formData.materials_shared, materialInput.trim()];
      handleFieldChange('materials_shared', updated);
      setMaterialInput('');
    }
  };

  const handleRemoveMaterial = (index) => {
    const updated = formData.materials_shared.filter((_, i) => i !== index);
    handleFieldChange('materials_shared', updated);
  };

  const handleAddSample = (e) => {
    e.preventDefault();
    if (sampleInput.trim()) {
      const updated = [...formData.samples_distributed, sampleInput.trim()];
      handleFieldChange('samples_distributed', updated);
      setSampleInput('');
    }
  };

  const handleRemoveSample = (index) => {
    const updated = formData.samples_distributed.filter((_, i) => i !== index);
    handleFieldChange('samples_distributed', updated);
  };

  // Submit chat note to FastAPI LangGraph endpoint
  const sendChatMessage = async (textToSend) => {
    if (!textToSend.trim()) return;

    dispatch(setLoading(true));
    dispatch(setError(null));

    // Optimistically update chat history with user message
    const userMsg = { sender: 'user', text: textToSend };
    // We send current history BEFORE adding this message, backend will append it
    const reqHistory = chatHistory.map(h => ({ sender: h.sender, text: h.text }));

    try {
      const response = await fetch('http://127.0.0.1:8000/api/interaction/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: textToSend,
          chat_history: reqHistory,
          current_form_data: formData,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to reach backend API. Make sure the FastAPI server is running.');
      }

      const data = await response.json();

      if (data.success) {
        // Sync Redux Store
        dispatch(setChatHistory(data.chat_history));
        dispatch(setFullFormData(data.extracted_data));
      } else {
        dispatch(setError('Backend processed the request but returned an error.'));
      }
    } catch (err) {
      console.error(err);
      dispatch(setError(err.message || 'Something went wrong connecting to the backend.'));
      // Local demo fallback if backend is offline
      dispatch(addChatMessage(userMsg));
      dispatch(addChatMessage({
        sender: 'assistant',
        text: '⚠️ Backend API offline. Simulating local extraction: I have filled in details for you based on keywords. (Connect FastAPI backend to test actual LangGraph workflow).'
      }));

      // Attempt quick parse
      const hcpMatch = textToSend.match(/(?:Dr\.|Doctor)\s+([A-Z][a-z]+)/i);
      const prodMatch = textToSend.match(/(?:OncoBoost|Keytruda|Humira|Ozempic)/i);

      const simulatedData = {};
      if (hcpMatch) simulatedData.hcp_name = `Dr. ${hcpMatch[1]}`;
      if (prodMatch) simulatedData.product = prodMatch[0];
      simulatedData.summary = textToSend;
      dispatch(setFullFormData(simulatedData));
    } finally {
      dispatch(setLoading(false));
    }
  };

  const handleChatSubmit = (e) => {
    e.preventDefault();
    if (!chatInput.trim() || isLoading) return;
    const text = chatInput;
    setChatInput('');
    sendChatMessage(text);
  };

  // Click handler for AI Suggested Follow-ups
  const handleApplyAISuggestion = (suggestion) => {
    const currentActions = formData.followup_actions;
    const separator = currentActions ? '\n• ' : '• ';
    handleFieldChange('followup_actions', currentActions + separator + suggestion);
  };

  // Connect real voice note speech-to-text recording
  const handleVoiceNoteClick = () => {
    if (!recognition) {
      dispatch(setError("Speech recognition is not supported in this browser. Please try Chrome, Edge, or Safari."));
      return;
    }

    if (voiceSimulating) {
      recognition.stop();
    } else {
      dispatch(setError(null));
      recognition.start();
    }
  };

  // Save the full structured form
  const handleFinalSubmit = async (e) => {
    e.preventDefault();
    dispatch(setLoading(true));
    dispatch(setError(null));
    try {
      const response = await fetch('http://127.0.0.1:8000/api/interaction/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to save interaction. Make sure the FastAPI server is running.');
      }

      const data = await response.json();
      if (data.success) {
        setLogSuccess(true);
        setTimeout(() => setLogSuccess(false), 5000);
        dispatch(resetForm());
      } else {
        dispatch(setError('Backend processed the request but failed to save.'));
      }
    } catch (err) {
      console.error(err);
      dispatch(setError(err.message || 'Something went wrong connecting to the backend.'));
    } finally {
      dispatch(setLoading(false));
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans transition-all duration-300">

      {/* Top Banner/Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center shadow-lg shadow-brand-500/20">
            <Sparkles className="h-5 w-5 text-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-wide">Pharma CRM</h1>
            <p className="text-xs text-slate-400">Interaction Intelligence Module</p>
          </div>
        </div>

        {/* View Toggle Controller */}
        <div className="bg-slate-900 border border-slate-800 p-1 rounded-xl flex items-center space-x-1">
          <button
            onClick={() => setActiveTab('form')}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center space-x-2 transition-all duration-200 ${activeTab === 'form' ? 'bg-brand-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <FileText className="h-4 w-4" />
            <span className="hidden md:inline">Structured Form</span>
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center space-x-2 transition-all duration-200 ${activeTab === 'chat' ? 'bg-brand-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <MessageSquare className="h-4 w-4" />
            <span className="hidden md:inline">AI Chat Assistant</span>
          </button>
          <button
            onClick={() => setActiveTab('split')}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center space-x-2 transition-all duration-200 ${activeTab === 'split' ? 'bg-brand-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <Columns className="h-4 w-4" />
            <span className="hidden md:inline">Split Dashboard</span>
          </button>
        </div>

        {/* Utilities */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              dispatch(resetForm());
              dispatch(clearChat());
            }}
            title="Reset interaction details"
            className="p-2 text-slate-400 hover:text-slate-200 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-6 grid grid-cols-1 gap-6 overflow-y-auto">

        {/* Error Notification */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-200 p-4 rounded-xl flex items-start space-x-3 animate-fadeIn">
            <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-sm">Synchronization Warning</h4>
              <p className="text-xs text-red-300 mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Success Notification */}
        {logSuccess && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 p-4 rounded-xl flex items-start space-x-3 animate-fadeIn">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-sm">Interaction Saved Successfully</h4>
              <p className="text-xs text-emerald-300 mt-1">HCP interaction records synced with PostgreSQL CRM database.</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

          {/* LEFT: Structured Form View */}
          <div className={`lg:col-span-7 space-y-6 ${activeTab === 'chat' ? 'hidden' : 'block'} ${activeTab === 'split' ? 'lg:block' : 'lg:col-span-12'}`}>
            <div className="bg-slate-950/40 border border-slate-800/80 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-4 mb-6">
                <div className="flex items-center space-x-2">
                  <Bookmark className="text-brand-500 h-5 w-5" />
                  <h2 className="text-lg font-bold text-white">Interaction Details</h2>
                </div>

                {/* Visual Status Lights for Validators */}
                <div className="flex items-center space-x-4 text-xs">
                  <span className="flex items-center space-x-1.5">
                    <span className={`h-2.5 w-2.5 rounded-full ${formData.hcp_name ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`}></span>
                    <span className="text-slate-400">HCP</span>
                  </span>
                  <span className="flex items-center space-x-1.5">
                    <span className={`h-2.5 w-2.5 rounded-full ${formData.product ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`}></span>
                    <span className="text-slate-400">Product</span>
                  </span>
                  <span className="flex items-center space-x-1.5">
                    <span className={`h-2.5 w-2.5 rounded-full ${formData.summary ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`}></span>
                    <span className="text-slate-400">Summary</span>
                  </span>
                </div>
              </div>

              <form onSubmit={handleFinalSubmit} className="space-y-5">

                {/* HCP & Product Row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">HCP Name *</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={formData.hcp_name}
                        onChange={(e) => handleFieldChange('hcp_name', e.target.value)}
                        placeholder="Search or select HCP..."
                        className="w-full bg-slate-900 border border-slate-800 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 transition-all outline-none"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Product Discussed *</label>
                    <input
                      type="text"
                      value={formData.product}
                      onChange={(e) => handleFieldChange('product', e.target.value)}
                      placeholder="e.g., OncoBoost, CardioRx"
                      className="w-full bg-slate-900 border border-slate-800 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 transition-all outline-none"
                      required
                    />
                  </div>
                </div>

                {/* Type, Date, Time Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Interaction Type</label>
                    <select
                      value={formData.interaction_type}
                      onChange={(e) => handleFieldChange('interaction_type', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 rounded-xl px-4 py-3 text-sm text-white transition-all outline-none cursor-pointer"
                    >
                      <option value="Meeting">Meeting</option>
                      <option value="Email">Email</option>
                      <option value="Phone Call">Phone Call</option>
                      <option value="Lunch & Learn">Lunch & Learn</option>
                      <option value="Conference">Conference</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Date</label>
                    <div className="relative">
                      <Calendar className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-500" />
                      <input
                        type="date"
                        value={formData.date}
                        onChange={(e) => handleFieldChange('date', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 rounded-xl pl-11 pr-4 py-2.5 text-sm text-white transition-all outline-none cursor-pointer"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Time</label>
                    <div className="relative">
                      <Clock className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-500" />
                      <input
                        type="time"
                        value={formData.time}
                        onChange={(e) => handleFieldChange('time', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 rounded-xl pl-11 pr-4 py-2.5 text-sm text-white transition-all outline-none cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* Attendees list input */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Attendees</label>
                  <div className="flex space-x-2">
                    <div className="relative flex-1">
                      <User className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-500" />
                      <input
                        type="text"
                        value={attendeeInput}
                        onChange={(e) => setAttendeeInput(e.target.value)}
                        placeholder="Add attendee name..."
                        className="w-full bg-slate-900 border border-slate-800 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 rounded-xl pl-11 pr-4 py-2.5 text-sm text-white placeholder-slate-500 transition-all outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddAttendee}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl flex items-center space-x-1.5 transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Add</span>
                    </button>
                  </div>

                  {/* Attendees Chips */}
                  {formData.attendees.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {formData.attendees.map((attendee, idx) => (
                        <span key={idx} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-slate-800 border border-slate-700 text-slate-200">
                          {attendee}
                          <button
                            type="button"
                            onClick={() => handleRemoveAttendee(idx)}
                            className="ml-2 text-slate-400 hover:text-slate-200 font-bold"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Topics Discussed (Structured Summary) */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Topics Discussed / Summary *</label>
                  <div className="relative">
                    <textarea
                      value={formData.summary}
                      onChange={(e) => handleFieldChange('summary', e.target.value)}
                      placeholder="Enter key discussion points or clinical findings discussed..."
                      rows={3}
                      className="w-full bg-slate-900 border border-slate-800 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 transition-all outline-none"
                      required
                    />
                    <button
                      type="button"
                      onClick={handleVoiceNoteClick}
                      className="absolute right-3.5 bottom-3.5 p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white border border-slate-700 transition-all flex items-center justify-center"
                      title={voiceSimulating ? "Stop recording" : "Summarize from Voice Note (Requires Consent)"}
                    >
                      <Mic className={`h-4 w-4 ${voiceSimulating ? 'text-red-500 animate-pulse scale-110' : ''}`} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleVoiceNoteClick}
                    className="mt-2 text-xs text-brand-400 hover:text-brand-300 font-medium flex items-center space-x-1.5 transition-colors"
                  >
                    <Sparkles className="h-3 w-3" />
                    <span>{voiceSimulating ? "Listening... Speak now (click again to stop)" : "Summarize from Voice Note (Requires Consent)"}</span>
                  </button>
                </div>

                {/* Shared Materials & Samples Distributed */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Materials Shared</label>
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        value={materialInput}
                        onChange={(e) => setMaterialInput(e.target.value)}
                        placeholder="Brochure, Study PDF..."
                        className="flex-1 bg-slate-900 border border-slate-800 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 transition-all outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleAddMaterial}
                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl transition-colors"
                      >
                        Add
                      </button>
                    </div>
                    {/* Material Chips */}
                    {formData.materials_shared.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {formData.materials_shared.map((mat, idx) => (
                          <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 text-xs text-slate-300">
                            {mat}
                            <button type="button" onClick={() => handleRemoveMaterial(idx)} className="ml-1.5 text-slate-500 hover:text-slate-300">×</button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-500 italic mt-2">No materials added.</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Samples Distributed</label>
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        value={sampleInput}
                        onChange={(e) => setSampleInput(e.target.value)}
                        placeholder="OncoBoost pack, clinical kit..."
                        className="flex-1 bg-slate-900 border border-slate-800 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 transition-all outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleAddSample}
                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl transition-colors"
                      >
                        Add
                      </button>
                    </div>
                    {/* Sample Chips */}
                    {formData.samples_distributed.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {formData.samples_distributed.map((sam, idx) => (
                          <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 text-xs text-slate-300">
                            {sam}
                            <button type="button" onClick={() => handleRemoveSample(idx)} className="ml-1.5 text-slate-500 hover:text-slate-300">×</button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-500 italic mt-2">No samples added.</p>
                    )}
                  </div>
                </div>

                {/* Sentiment Radio Buttons */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Observed/Inferred HCP Sentiment</label>
                  <div className="flex items-center space-x-6 bg-slate-900 border border-slate-800/80 p-3.5 rounded-xl w-fit">
                    {[
                      { value: 'Positive', emoji: '😊', color: 'text-emerald-400' },
                      { value: 'Neutral', emoji: '😐', color: 'text-yellow-400' },
                      { value: 'Negative', emoji: '😒', color: 'text-rose-400' }
                    ].map((item) => (
                      <label key={item.value} className="flex items-center space-x-2.5 cursor-pointer select-none">
                        <input
                          type="radio"
                          name="sentiment"
                          value={item.value}
                          checked={formData.sentiment === item.value}
                          onChange={() => handleFieldChange('sentiment', item.value)}
                          className="h-4.5 w-4.5 text-brand-600 focus:ring-brand-500 border-slate-800 bg-slate-900 cursor-pointer"
                        />
                        <span className="text-sm font-medium text-slate-200 flex items-center space-x-1.5">
                          <span>{item.emoji}</span>
                          <span className={formData.sentiment === item.value ? 'font-semibold text-white' : ''}>{item.value}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Outcomes */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Outcomes / Agreements</label>
                  <textarea
                    value={formData.outcomes}
                    onChange={(e) => handleFieldChange('outcomes', e.target.value)}
                    placeholder="Key agreements, doctor queries, clinical trial feedbacks..."
                    rows={2}
                    className="w-full bg-slate-900 border border-slate-800 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 transition-all outline-none"
                  />
                </div>

                {/* Follow-up actions */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Follow-up Actions</label>
                  <textarea
                    value={formData.followup_actions}
                    onChange={(e) => handleFieldChange('followup_actions', e.target.value)}
                    placeholder="Enter next steps or action items..."
                    rows={2}
                    className="w-full bg-slate-900 border border-slate-800 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 transition-all outline-none"
                  />
                </div>

                {/* AI Suggested Follow-ups */}
                <div className="border-t border-slate-800/80 pt-4">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-brand-400 mb-2.5 flex items-center space-x-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>AI Suggested Follow-ups (Click to Apply)</span>
                  </span>
                  <div className="space-y-2">
                    {[
                      "Schedule follow-up meeting in 2 weeks to discuss study outcomes",
                      "Send clinical trial PDF data document regarding OncoBoost Phase III",
                      "Add Dr. Jenkins to the steering advisory board panel list"
                    ].map((sug, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleApplyAISuggestion(sug)}
                        className="w-full text-left px-3.5 py-2.5 rounded-lg bg-brand-950/20 border border-brand-900/35 hover:bg-brand-950/40 text-slate-300 text-xs font-medium flex items-center justify-between group transition-all"
                      >
                        <span className="group-hover:text-white transition-colors">{sug}</span>
                        <Plus className="h-3.5 w-3.5 text-brand-400 group-hover:text-white group-hover:scale-110 transition-all ml-2 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Submit Form */}
                <div className="pt-4">
                  <button
                    type="submit"
                    className="w-full py-3.5 bg-brand-600 hover:bg-brand-500 text-white font-semibold rounded-xl transition-all flex items-center justify-center space-x-2 shadow-lg shadow-brand-600/20 active:translate-y-[1px]"
                  >
                    <Check className="h-5 w-5" />
                    <span>Commit and Log to CRM</span>
                  </button>
                </div>

              </form>
            </div>
          </div>

          {/* RIGHT: AI Chat Assistant Panel */}
          <div className={`lg:col-span-5 space-y-6 ${activeTab === 'form' ? 'hidden' : 'block'} ${activeTab === 'split' ? 'lg:block' : 'lg:col-span-12'}`}>
            <div className="bg-slate-950/40 border border-slate-800/80 rounded-2xl flex flex-col h-[740px] shadow-xl overflow-hidden backdrop-blur-sm">

              {/* Card Header */}
              <div className="bg-slate-950 border-b border-slate-800/80 px-6 py-4.5 flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="h-3 w-3 bg-brand-500 rounded-full animate-pulse"></div>
                  <div>
                    <h2 className="text-md font-bold text-white">AI Assistant</h2>
                    <p className="text-[10px] text-slate-400">Log interaction via natural conversational chat</p>
                  </div>
                </div>
                {dispatch && (
                  <button
                    onClick={() => dispatch(clearChat())}
                    className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    Clear Chat
                  </button>
                )}
              </div>

              {/* Chat Thread */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin">
                {chatHistory.map((msg, index) => (
                  <div
                    key={index}
                    className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} animate-fadeIn`}
                  >
                    <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${msg.sender === 'user'
                      ? 'bg-brand-600 text-white rounded-br-none'
                      : 'bg-slate-900 border border-slate-800/80 text-slate-200 rounded-bl-none'
                      }`}>
                      {msg.sender === 'assistant' && (
                        <div className="flex items-center space-x-1 mb-1.5">
                          <Sparkles className="h-3.5 w-3.5 text-brand-400" />
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">AI Assistant</span>
                        </div>
                      )}
                      <p>{msg.text}</p>
                    </div>
                  </div>
                ))}

                {/* Loading indicator */}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-slate-900 border border-slate-800/80 rounded-2xl rounded-bl-none px-4 py-3 text-sm text-slate-300 flex items-center space-x-3 shadow-sm">
                      <div className="flex space-x-1">
                        <span className="h-2 w-2 bg-brand-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="h-2 w-2 bg-brand-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="h-2 w-2 bg-brand-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                      <span className="text-xs text-slate-400 font-medium">LangGraph workflow processing...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Chat Footer Input */}
              <div className="bg-slate-950 border-t border-slate-800/80 p-4">
                <form onSubmit={handleChatSubmit} className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Describe interaction or answer follow-up questions..."
                    className="flex-1 bg-slate-900 border border-slate-800 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 rounded-xl px-4 py-3.5 text-sm text-white placeholder-slate-500 transition-all outline-none"
                    disabled={isLoading}
                  />
                  <button
                    type="submit"
                    disabled={!chatInput.trim() || isLoading}
                    className="h-[46px] w-[46px] bg-brand-600 hover:bg-brand-500 disabled:bg-slate-800 text-white rounded-xl flex items-center justify-center transition-all disabled:opacity-50 active:scale-95 shrink-0"
                  >
                    <Send className="h-4.5 w-4.5" />
                  </button>
                </form>
                <div className="flex items-center justify-between mt-2.5 px-1">
                  <span className="text-[10px] text-slate-500 flex items-center space-x-1">
                    <AlertCircle className="h-3 w-3" />
                    <span>State updates form fields in real-time.</span>
                  </span>
                </div>
              </div>

            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
