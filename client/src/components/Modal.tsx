
import React from 'react';
import { createPortal } from 'react-dom';

type Props = {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
};

export default function Modal({ isOpen, onClose, title, children }: Props) {
    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-lg border border-nexus-border bg-nexus-card p-6 shadow-xl relative">
                <button
                    onClick={onClose}
                    className="absolute right-4 top-4 text-nexus-muted hover:text-nexus-text transition"
                >
                    ✕
                </button>
                <h2 className="mb-4 text-xl font-semibold text-nexus-text">{title}</h2>
                {children}
            </div>
        </div>,
        document.body
    );
}
