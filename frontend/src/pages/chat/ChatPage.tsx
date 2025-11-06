import React, { useState, useEffect } from 'react';
import { useChat } from '../../hooks/useChat';
import Chat from '../../components/Chat';

const ChatPage: React.FC = () => {
  const [selectedCompanyId, setSelectedCompanyId] = useState<number>(1); // Default to first company
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

  const {
    conversations,
    currentConversation,
    isLoading,
    error,
    fetchConversations,
    fetchConversation,
    createConversation,
    sendMessage,
    deleteConversation
  } = useChat(selectedCompanyId);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const handleSendMessage = async (message: string) => {
    try {
      if (selectedConversationId) {
        // Send to existing conversation
        await sendMessage(selectedConversationId, message);
      } else {
        // Create new conversation
        const newConversationId = await createConversation(message);
        setSelectedConversationId(newConversationId);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  const handleSelectConversation = (conversationId: string) => {
    setSelectedConversationId(conversationId);
    fetchConversation(conversationId);
  };

  const handleNewConversation = () => {
    setSelectedConversationId(null);
  };

  const handleDeleteConversation = async (conversationId: string) => {
    if (window.confirm('Är du säker på att du vill radera denna konversation?')) {
      await deleteConversation(conversationId);
      if (selectedConversationId === conversationId) {
        setSelectedConversationId(null);
      }
    }
  };

  const messages = currentConversation?.messages || [];

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar with conversation history */}
      <div className="w-80 bg-white border-r flex flex-col">
        <div className="p-4 border-b">
          <button
            onClick={handleNewConversation}
            className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Ny konversation
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-4 text-gray-500 text-center">
              <p>Inga konversationer än</p>
              <p className="text-sm mt-2">Starta en ny konversation för att komma igång</p>
            </div>
          ) : (
            <div className="divide-y">
              {conversations.map((conv) => (
                <div
                  key={conv._id}
                  className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                    selectedConversationId === conv._id ? 'bg-blue-50' : ''
                  }`}
                  onClick={() => handleSelectConversation(conv._id)}
                >
                  <div className="flex justify-between items-start">
                    <h3 className="font-medium text-sm line-clamp-2">{conv.title}</h3>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteConversation(conv._id);
                      }}
                      className="text-red-600 hover:text-red-800 text-xs"
                    >
                      Radera
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(conv.updatedAt).toLocaleDateString('sv-SE')}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {conv.messages.length} meddelanden
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col">
        <div className="bg-white border-b p-4">
          <h1 className="text-xl font-semibold">AI Redovisningsassistent</h1>
          <p className="text-sm text-gray-600">
            {selectedConversationId
              ? currentConversation?.title
              : 'Starta en ny konversation'}
          </p>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 m-4 rounded">
            <p>Fel: {error}</p>
          </div>
        )}

        <div className="flex-1 bg-white">
          <Chat
            messages={messages}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
};

export default ChatPage;
