// [DEBUG] chats come from: useChatStore().chats
// [DEBUG] currentChatId comes from: useChatStore().currentChatId
// [DEBUG] selectChat is called here: onSelect handler in ChatItem

import { useState, useEffect } from 'react';
import { useChatStore } from '../store/chatStore';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * Chat Sidebar Component with CRUD, Pin, and Drag & Drop
 */
const ChatSidebar = () => {
  const {
    chats,
    activeChatId,
    currentChatId,
    loading,
    firestoreError,
    loadChatsFromFirestore,
    createChat,
    selectChat,
    renameChat,
    deleteChat,
    pinChat,
    moveChat,
    reorderChat, // Keep for drag & drop
  } = useChatStore();

  const [editingChatId, setEditingChatId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [menuOpenId, setMenuOpenId] = useState(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuOpenId && !e.target.closest('.chat-item-menu')) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [menuOpenId]);

  // Sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Load chats on mount
  useEffect(() => {
    loadChatsFromFirestore();
  }, [loadChatsFromFirestore]);

  // Auto-select first chat if none selected
  useEffect(() => {
    const chatIdToUse = currentChatId || activeChatId;
    if (!chatIdToUse && chats.length > 0) {
      selectChat(chats[0].id);
    }
  }, [chats, currentChatId, activeChatId, selectChat]);

  const handleCreateNewChat = async () => {
    try {
      await createChat();
      setMenuOpenId(null);
    } catch (error) {
      console.error('Error creating chat:', error);
    }
  };

  const handleRename = async (chatId, currentTitle) => {
    console.log('[SIDEBAR] Rename', chatId, editTitle.trim());
    if (editTitle.trim() && editTitle !== currentTitle) {
      try {
        await renameChat(chatId, editTitle.trim());
      } catch (error) {
        console.error('Error renaming chat:', error);
      }
    }
    setEditingChatId(null);
    setEditTitle('');
  };

  const handleDelete = async (chatId) => {
    console.log('[SIDEBAR] Delete', chatId);
    if (window.confirm('Sei sicuro di voler eliminare questa chat?')) {
      try {
        await deleteChat(chatId);
      } catch (error) {
        console.error('Error deleting chat:', error);
        alert(error.message || 'Errore durante l\'eliminazione');
      }
    }
    setMenuOpenId(null);
  };

  const handleTogglePin = async (chatId) => {
    console.log('[SIDEBAR] Pin/Unpin', chatId);
    try {
      await pinChat(chatId);
    } catch (error) {
      console.error('Error toggling pin:', error);
      alert(error.message || 'Errore durante il pin/unpin');
    }
    setMenuOpenId(null);
  };

  const handleMoveUp = async (chatId) => {
    console.log('[SIDEBAR] Move up', chatId);
    try {
      await moveChat(chatId, 'up');
    } catch (error) {
      console.error('Error moving chat up:', error);
    }
    setMenuOpenId(null);
  };

  const handleMoveDown = async (chatId) => {
    console.log('[SIDEBAR] Move down', chatId);
    try {
      await moveChat(chatId, 'down');
    } catch (error) {
      console.error('Error moving chat down:', error);
    }
    setMenuOpenId(null);
  };

  const handleDragEnd = async (event) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    // Only allow reordering unpinned chats
    const unpinnedChats = chats.filter(c => !c.pinned);
    const activeChat = unpinnedChats.find(c => c.id === active.id);
    const overChat = unpinnedChats.find(c => c.id === over.id);

    if (!activeChat || !overChat) {
      return; // Can't drag pinned chats
    }

    const oldIndex = unpinnedChats.findIndex(c => c.id === active.id);
    const newIndex = unpinnedChats.findIndex(c => c.id === over.id);

    const newOrder = arrayMove(unpinnedChats, oldIndex, newIndex);
    const newOrderIds = newOrder.map(c => c.id);
    
    // Use reorderChats from store (it's still available)
    const { reorderChats } = useChatStore.getState();
    await reorderChats(newOrderIds);
  };

  const pinnedChats = chats.filter(c => c.pinned);
  const unpinnedChats = chats.filter(c => !c.pinned);

  return (
    <div className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col h-screen">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <button
          onClick={handleCreateNewChat}
          className="w-full flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Nuova Chat</span>
        </button>
      </div>

      {/* Error Display */}
      {firestoreError && (
        <div className="p-4 bg-red-900/20 border-b border-red-800 text-red-400 text-sm">
          {firestoreError}
        </div>
      )}

      {/* Chat List */}
      <div className="flex-1 overflow-y-auto">
        {/* Pinned Section */}
        {pinnedChats.length > 0 && (
          <>
            <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase">
              Fissate
            </div>
            <div className="space-y-1 px-2">
              {pinnedChats.map((chat) => {
                const chatIdToUse = currentChatId || activeChatId;
                return (
                  <ChatItem
                    key={chat.id}
                    chat={chat}
                    isActive={chat.id === chatIdToUse}
                    onSelect={() => {
                      console.log('[SIDEBAR] Click chat ->', chat.id);
                      selectChat(chat.id);
                    }}
                  onRename={(title) => {
                    setEditingChatId(chat.id);
                    setEditTitle(title);
                  }}
                  onDelete={() => handleDelete(chat.id)}
                  onTogglePin={() => handleTogglePin(chat.id)}
                  isEditing={editingChatId === chat.id}
                  editTitle={editTitle}
                  onEditChange={setEditTitle}
                  onEditSave={() => handleRename(chat.id, chat.title)}
                  onEditCancel={() => {
                    setEditingChatId(null);
                    setEditTitle('');
                  }}
                  menuOpen={menuOpenId === chat.id}
                  onMenuToggle={() => {
                    const newMenuId = menuOpenId === chat.id ? null : chat.id;
                    console.log('[SIDEBAR] Open menu ->', newMenuId);
                    setMenuOpenId(newMenuId);
                  }}
                  isPinned={true}
                  canMove={false}
                  />
                );
              })}
            </div>
            <div className="h-px bg-gray-800 mx-4 my-2" />
          </>
        )}

        {/* Unpinned Section */}
        <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase">
          Tutte le chat
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={unpinnedChats.map(c => c.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-1 px-2">
              {unpinnedChats.map((chat) => {
                const chatIdToUse = currentChatId || activeChatId;
                return (
                  <SortableChatItem
                    key={chat.id}
                    chat={chat}
                    isActive={chat.id === chatIdToUse}
                    onSelect={() => {
                      console.log('[SIDEBAR] Click chat ->', chat.id);
                      selectChat(chat.id);
                    }}
                  onRename={(title) => {
                    setEditingChatId(chat.id);
                    setEditTitle(title);
                  }}
                  onDelete={() => handleDelete(chat.id)}
                  onTogglePin={() => handleTogglePin(chat.id)}
                  onMoveUp={() => handleMoveUp(chat.id)}
                  onMoveDown={() => handleMoveDown(chat.id)}
                  isEditing={editingChatId === chat.id}
                  editTitle={editTitle}
                  onEditChange={setEditTitle}
                  onEditSave={() => handleRename(chat.id, chat.title)}
                  onEditCancel={() => {
                    setEditingChatId(null);
                    setEditTitle('');
                  }}
                  menuOpen={menuOpenId === chat.id}
                  onMenuToggle={() => setMenuOpenId(menuOpenId === chat.id ? null : chat.id)}
                  isPinned={false}
                  canMove={true}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>

        {chats.length === 0 && !loading && (
          <div className="p-4 text-center text-gray-500 text-sm">
            Nessuna chat. Crea una nuova chat per iniziare.
          </div>
        )}

        {loading && (
          <div className="p-4 text-center text-gray-500 text-sm">
            Caricamento...
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Sortable Chat Item (for drag & drop)
 * NOTE: Drag listeners are only on the drag handle, not the whole row
 */
const SortableChatItem = (props) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.chat.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Don't apply drag listeners to the whole item - only allow dragging from a handle
  // This prevents interference with click handlers
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <ChatItem {...props} />
    </div>
  );
};

/**
 * Chat Item Component
 */
const ChatItem = ({
  chat,
  isActive,
  onSelect,
  onRename,
  onDelete,
  onTogglePin,
  onMoveUp,
  onMoveDown,
  isEditing,
  editTitle,
  onEditChange,
  onEditSave,
  onEditCancel,
  menuOpen,
  onMenuToggle,
  isPinned,
  canMove,
}) => {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      onEditSave();
    } else if (e.key === 'Escape') {
      onEditCancel();
    }
  };

  return (
    <div
      className={`group relative flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
        isActive
          ? 'bg-gray-800 text-white'
          : 'hover:bg-gray-800/50 text-gray-300'
      }`}
      onClick={(e) => {
        if (!isEditing && onSelect) {
          e.stopPropagation();
          onSelect();
        }
      }}
    >
      {isPinned && (
        <svg className="w-4 h-4 text-yellow-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
        </svg>
      )}

      {isEditing ? (
        <input
          type="text"
          value={editTitle}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={onEditSave}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-gray-700 text-white px-2 py-1 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          <span className="flex-1 truncate text-sm">{chat.title}</span>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMenuToggle();
              }}
              className="p-1 hover:bg-gray-700 rounded"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
            </button>
          </div>
        </>
      )}

      {/* Menu Dropdown */}
      {menuOpen && !isEditing && (
        <div
          className="chat-item-menu absolute right-2 top-full mt-1 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-50"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRename(chat.title);
              onMenuToggle();
            }}
            className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Rinomina
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d={isPinned ? "M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" : "M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z"} />
            </svg>
            {isPinned ? 'Rimuovi fissata' : 'Fissa'}
          </button>
          {canMove && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveUp();
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
                Sposta su
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveDown();
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                Sposta giù
              </button>
            </>
          )}
          <div className="h-px bg-gray-700 my-1" />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-700 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Elimina
          </button>
        </div>
      )}
    </div>
  );
};

export default ChatSidebar;

