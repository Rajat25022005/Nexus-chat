import type { Message } from "./ChatLayout"
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useState } from 'react'

// --- Helper Component for the Copy Button ---
const CodeBlockHeader = ({ language, code }: { language: string, code: string }) => {
  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = () => {
    if (!code) return
    navigator.clipboard.writeText(code)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000) // Reset text after 2 seconds
  }

  return (
    <div className="bg-[#1e1e1e] px-3 py-1 text-xs text-gray-400 border-b border-white/5 flex justify-between items-center select-none">
      <span className="lowercase">{language}</span>
      <button 
        onClick={handleCopy} 
        className="hover:text-white transition-colors cursor-pointer flex items-center gap-1"
        aria-label="Copy code to clipboard"
      >
        {isCopied ? (
          <span className="text-green-400 font-medium">Copied!</span>
        ) : (
          <span>Copy</span>
        )}
      </button>
    </div>
  )
}

// --- Main Message Bubble Component ---
export default function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user"

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`
          max-w-[85%] rounded-xl text-sm overflow-hidden
          ${
            isUser
              ? "bg-nexus-primary text-white rounded-br-sm px-4 py-2"
              : "bg-nexus-card text-nexus-text rounded-bl-sm p-0" 
          }
        `}
      >
        {isUser ? (
          // User messages are simple text
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          // AI messages get full Markdown + Code Highlighting treatment
          <div className="markdown-container px-4 py-2">
            <ReactMarkdown
              components={{
                code({ node, inline, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || '')
                  const codeContent = String(children).replace(/\n$/, '') // Get raw code for copying

                  return !inline && match ? (
                    // BLOCK CODE (```python ...)
                    <div className="my-3 rounded-md overflow-hidden border border-white/10">
                      {/* Use the new Header Component with Copy Logic */}
                      <CodeBlockHeader language={match[1]} code={codeContent} />
                      
                      <SyntaxHighlighter
                        style={vscDarkPlus}
                        language={match[1]}
                        PreTag="div"
                        customStyle={{ margin: 0, borderRadius: 0, fontSize: '13px' }}
                        {...props}
                      >
                        {codeContent}
                      </SyntaxHighlighter>
                    </div>
                  ) : (
                    // INLINE CODE (`variable`)
                    <code 
                      className="bg-black/30 text-red-400 rounded px-1.5 py-0.5 font-mono text-xs" 
                      {...props}
                    >
                      {children}
                    </code>
                  )
                }
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}