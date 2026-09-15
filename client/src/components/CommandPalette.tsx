import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Hash,
  Users,
  MessageSquarePlus,
  FolderPlus,
  Link,
  Settings,
  User,
  UserSearch,
  Sun,
  LogOut
} from 'lucide-react';
import { useThemeStore } from '../stores/themeStore';
import { cn } from '../lib/utils';
import type { Group, DirectChat } from '../types';

type CommandPaletteProps = {
  isOpen: boolean;
  onClose: () => void;
  groups: Group[];
  directChats?: DirectChat[];
  activeGroupId?: string;
  onSelectGroup: (groupId: string) => void;
  onSelectChat: (chatId: string) => void;
  onSelectDirectChat?: (chatId: string) => void;
  onNavigate: (path: string) => void;
  onAction: (action: string) => void;
};

type ActionItem = {
  id: string;
  label: string;
  icon: React.ElementType;
  actionId?: string;
  path?: string;
};

type FlattenedItem = 
  | { type: 'channel'; id: string; label: string; subtitle: string; groupId: string; chatId: string; icon: React.ElementType }
  | { type: 'direct'; id: string; label: string; subtitle: string; chatId: string; icon: React.ElementType }
  | { type: 'workspace'; id: string; label: string; groupId: string; icon: React.ElementType }
  | { type: 'action'; id: string; label: string; actionId?: string; path?: string; icon: React.ElementType };

const ACTIONS: ActionItem[] = [
  { id: 'action-search-users', label: 'Search Users / Direct Message', icon: UserSearch, actionId: 'search-users' },
  { id: 'action-toggle-theme', label: 'Toggle Theme', icon: Sun, actionId: 'toggle-theme' },
  { id: 'action-new-chat', label: 'New Chat', icon: MessageSquarePlus, actionId: 'new-chat' },
  { id: 'action-new-group', label: 'New Group', icon: FolderPlus, actionId: 'new-group' },
  { id: 'action-join-group', label: 'Join Group', icon: Link, actionId: 'join-group' },
  { id: 'action-settings', label: 'Settings', icon: Settings, path: '/settings' },
  { id: 'action-profile', label: 'Profile', icon: User, path: '/profile' },
  { id: 'action-logout', label: 'Log Out', icon: LogOut, actionId: 'logout' },
];

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  groups,
  directChats = [],
  onSelectGroup,
  onSelectChat,
  onSelectDirectChat,
  onNavigate,
  onAction
}) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Focus input when opened and restore focus when closed
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement | null;
      const timer = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(timer);
    } else if (previousActiveElement.current) {
      previousActiveElement.current.focus();
      previousActiveElement.current = null;
    }
  }, [isOpen]);

  // Compute flattened and filtered items
  const items = useMemo(() => {
    const lowerQuery = query.toLowerCase();

    // Direct Messages
    const directItems: FlattenedItem[] = directChats
      .filter(dc =>
        dc.recipient.display_name.toLowerCase().includes(lowerQuery) ||
        (dc.recipient.username && dc.recipient.username.toLowerCase().includes(lowerQuery))
      )
      .map(dc => ({
        type: 'direct',
        id: `direct-${dc.chat_id}`,
        label: dc.recipient.display_name,
        subtitle: dc.recipient.username ? `@${dc.recipient.username}` : 'Direct Message',
        chatId: dc.chat_id,
        icon: User
      }));
    
    // Channels
    const channels: FlattenedItem[] = [];
    groups.forEach(group => {
      group.chats.forEach(chat => {
        if (chat.title.toLowerCase().includes(lowerQuery) || group.name.toLowerCase().includes(lowerQuery)) {
          channels.push({
            type: 'channel',
            id: `channel-${group.id}-${chat.id}`,
            label: chat.title,
            subtitle: group.name,
            groupId: group.id,
            chatId: chat.id,
            icon: Hash
          });
        }
      });
    });

    // Workspaces
    const workspaces: FlattenedItem[] = groups
      .filter(g => g.name.toLowerCase().includes(lowerQuery))
      .map(g => ({
        type: 'workspace',
        id: `workspace-${g.id}`,
        label: g.name,
        groupId: g.id,
        icon: Users
      }));

    // Actions
    const actions: FlattenedItem[] = ACTIONS
      .filter(a => a.label.toLowerCase().includes(lowerQuery))
      .map(a => ({
        type: 'action',
        id: a.id,
        label: a.label,
        actionId: a.actionId,
        path: a.path,
        icon: a.icon
      }));

    return [...directItems, ...channels, ...workspaces, ...actions];
  }, [groups, directChats, query]);

  // Group items for rendering
  const groupedItems = useMemo(() => {
    const directMessages = items.filter(item => item.type === 'direct');
    const channels = items.filter(item => item.type === 'channel');
    const workspaces = items.filter(item => item.type === 'workspace');
    const actions = items.filter(item => item.type === 'action');
    
    return [
      { section: 'Direct Messages', items: directMessages },
      { section: 'Channels', items: channels },
      { section: 'Workspaces', items: workspaces },
      { section: 'Actions', items: actions }
    ].filter(group => group.items.length > 0);
  }, [items]);

  useEffect(() => {
    if (listRef.current && items.length > 0) {
      const activeElement = listRef.current.querySelector(`[data-index="${activeIndex}"]`) as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeIndex, items]);

  const handleClose = useCallback(() => {
    setQuery('');
    setActiveIndex(0);
    onClose();
  }, [onClose]);

  const handleSelect = useCallback((item: FlattenedItem) => {
    if (item.type === 'direct') {
      if (onSelectDirectChat) onSelectDirectChat(item.chatId);
      else onSelectChat(item.chatId);
    } else if (item.type === 'channel') {
      onSelectGroup(item.groupId);
      onSelectChat(item.chatId);
    } else if (item.type === 'workspace') {
      onSelectGroup(item.groupId);
    } else if (item.type === 'action') {
      if (item.actionId === 'toggle-theme') {
        useThemeStore.getState().toggleTheme();
      } else if (item.actionId) {
        onAction(item.actionId);
      }
      if (item.path) onNavigate(item.path);
    }
    handleClose();
  }, [onSelectDirectChat, onSelectGroup, onSelectChat, onAction, onNavigate, handleClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (items.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex(prev => (prev + 1) % items.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex(prev => (prev - 1 + items.length) % items.length);
        break;
      case 'Enter':
        e.preventDefault();
        if (items[activeIndex]) {
          handleSelect(items[activeIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        handleClose();
        break;
    }
  }, [items, activeIndex, handleSelect, handleClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
            aria-hidden="true"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="relative w-full max-w-lg bg-nexus-card/90 backdrop-blur-2xl border border-nexus-border/50 rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Search Input */}
            <div className="relative flex items-center border-b border-nexus-border/30 px-4 py-3.5">
              <Search className="w-5 h-5 text-nexus-muted mr-3 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Search channels, workspaces, or actions..."
                className="w-full bg-transparent border-none outline-none text-sm text-nexus-text placeholder-nexus-muted/60"
              />
              <div className="absolute right-4 flex items-center shrink-0 pointer-events-none">
                <span className="text-[10px] bg-nexus-surface px-1.5 py-0.5 rounded text-nexus-muted/50 border border-nexus-border/30">
                  ⌘K
                </span>
              </div>
            </div>

            {/* Results */}
            <div className="max-h-80 overflow-y-auto scrollbar-thin py-2" role="listbox" ref={listRef}>
              {items.length === 0 ? (
                <div className="text-center py-8 text-nexus-muted/50 text-sm">
                  No results found
                </div>
              ) : (
                groupedItems.map(group => (
                  <div key={group.section} className="mb-2 last:mb-0">
                    <div className="text-[10px] uppercase tracking-wider text-nexus-muted/60 font-semibold px-4 pt-3 pb-1">
                      {group.section}
                    </div>
                    {group.items.map((item) => {
                      const itemIndex = items.findIndex(i => i.id === item.id);
                      const isActive = itemIndex === activeIndex;
                      const Icon = item.icon;

                      return (
                        <div
                          key={item.id}
                          role="option"
                          aria-selected={isActive}
                          data-index={itemIndex}
                          onClick={() => handleSelect(item)}
                          onMouseEnter={() => setActiveIndex(itemIndex)}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 mx-2 rounded-lg cursor-pointer transition-colors duration-100",
                            isActive 
                              ? "bg-nexus-primary/10 text-nexus-text" 
                              : "text-nexus-text/70 hover:bg-nexus-hover"
                          )}
                        >
                          <Icon className={cn("w-4 h-4", isActive ? "text-nexus-primary" : "text-nexus-muted")} />
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-sm truncate">{item.label}</span>
                            {item.type === 'channel' && (
                              <span className="text-[11px] text-nexus-muted/50 truncate">
                                in {item.subtitle}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-4 text-[10px] text-nexus-muted/40 px-4 py-2 border-t border-nexus-border/20 bg-nexus-surface/30">
              <span className="flex items-center gap-1"><kbd className="font-sans">↑↓</kbd> Navigate</span>
              <span className="flex items-center gap-1"><kbd className="font-sans">↵</kbd> Select</span>
              <span className="flex items-center gap-1"><kbd className="font-sans">esc</kbd> Close</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default CommandPalette;
