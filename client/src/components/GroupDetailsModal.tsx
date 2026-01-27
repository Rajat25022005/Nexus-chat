import { useState } from "react"
import Modal from "./Modal"
import { type Group } from "../hooks/useWorkspace"

type Props = {
    isOpen: boolean
    onClose: () => void
    group: Group
    currentUserEmail: string
    onLeave: (groupId: string) => void
    onRemoveMember: (groupId: string, email: string) => void
}

export default function GroupDetailsModal({
    isOpen,
    onClose,
    group,
    currentUserEmail,
    onLeave,
    onRemoveMember,
}: Props) {
    const isOwner = group.user_id === currentUserEmail
    const isPersonal = group.id.startsWith("personal_")

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Group Details">
            <div className="flex flex-col gap-6">
                {/* Header Info */}
                <div className="bg-[#202c33] p-4 rounded-lg flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-nexus-text">{group.name}</h3>
                        <p className="text-xs text-nexus-muted mt-1 font-mono">ID: {group.id}</p>
                    </div>
                    {/* Exit Group Button (Not for personal, not for owner) */}
                    {!isPersonal && !isOwner && (
                        <button
                            onClick={() => {
                                onLeave(group.id)
                                onClose()
                            }}
                            className="px-3 py-1.5 bg-red-600/10 text-red-400 hover:bg-red-600/20 rounded text-sm transition border border-red-600/20"
                        >
                            Exit Group
                        </button>
                    )}
                    {/* Owner cannot leave, must delete (handled in sidebar) */}
                    {isOwner && !isPersonal && (
                        <span className="text-xs text-nexus-muted italic">You are the owner</span>
                    )}
                </div>

                {/* Member List */}
                <div>
                    <h4 className="text-sm font-semibold text-nexus-primary uppercase tracking-wider mb-2">Members ({group.members.length})</h4>
                    <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                        {group.members.map(member => (
                            <div key={member} className="flex items-center justify-between p-2 rounded bg-nexus-input hover:bg-[#2a3942] transition group/member">
                                <div className="flex items-center gap-2 overflow-hidden">
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-xs font-bold text-white uppercase">
                                        {member.substring(0, 2)}
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className={`text-sm truncate ${member === currentUserEmail ? "font-bold text-white" : "text-gray-300"}`}>
                                            {member === currentUserEmail ? `${member} (You)` : member}
                                        </span>
                                        {group.user_id === member && (
                                            <span className="text-[10px] text-nexus-primary">Owner</span>
                                        )}
                                    </div>
                                </div>

                                {/* Remove Button: Only Owner can remove others */}
                                {isOwner && member !== currentUserEmail && (
                                    <button
                                        onClick={() => onRemoveMember(group.id, member)}
                                        className="opacity-0 group-hover/member:opacity-100 text-red-400 hover:text-red-500 text-xs px-2 py-1 rounded hover:bg-red-900/20 transition"
                                    >
                                        Remove
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </Modal>
    )
}
