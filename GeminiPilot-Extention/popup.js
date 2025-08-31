document.addEventListener('DOMContentLoaded', () => {
    const promptForm = document.getElementById('prompt-form');
    const promptInput = document.getElementById('prompt-input');
    const chatContainer = document.getElementById('chat-container');
    const loadingIndicator = document.getElementById('loading-indicator');
    const loadingText = document.getElementById('loading-text');
    const cancelBtn = document.getElementById('cancel-btn');
    const clearBtn = document.getElementById('clear-btn');

    const CHAT_HISTORY_KEY = 'gemini_chat_history';

    // --- Main Functions ---

    loadChatHistory();

    chrome.runtime.onMessage.addListener((request) => {
        if (request.type === 'STATUS_UPDATE') {
            handleStatusUpdate(request);
        }
    });

    promptForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const userPrompt = promptInput.value.trim();
        if (!userPrompt) return;

        addMessage({ text: userPrompt, sender: 'user' });
        promptInput.value = '';
        loadingText.textContent = 'Starting task...';
        loadingIndicator.classList.remove('hidden');

        chrome.runtime.sendMessage({ type: 'START_TASK', prompt: userPrompt });
    });

    cancelBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'CANCEL_TASK' });
    });

    clearBtn.addEventListener('click', () => {
        chatContainer.innerHTML = '';
        addMessage({ text: 'Hello! How can I help you automate tasks on this page?', sender: 'assistant' }, false);
        chrome.storage.local.remove(CHAT_HISTORY_KEY);
    });

    // --- NEW: Event listener for copy buttons ---
    chatContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('copy-code-btn')) {
            const pre = e.target.closest('.relative').querySelector('pre');
            const code = pre.textContent;
            
            navigator.clipboard.writeText(code).then(() => {
                e.target.textContent = 'Copied!';
                setTimeout(() => { e.target.textContent = 'Copy'; }, 2000);
            }).catch(err => {
                console.error('Failed to copy text: ', err);
                // Fallback for older browsers or if clipboard API fails
                const textArea = document.createElement("textarea");
                textArea.value = code;
                document.body.appendChild(textArea);
                textArea.select();
                try {
                    document.execCommand('copy');
                    e.target.textContent = 'Copied!';
                    setTimeout(() => { e.target.textContent = 'Copy'; }, 2000);
                } catch (fallbackErr) {
                    console.error('Fallback copy failed: ', fallbackErr);
                }
                document.body.removeChild(textArea);
            });
        }
    });

    // --- Helper Functions ---

    function handleStatusUpdate(request) {
        if (request.message) {
            addMessage({ text: request.message, sender: 'assistant' });
        }
        loadingIndicator.classList.toggle('hidden', !request.loading);
        if(request.loading) {
            loadingText.textContent = request.loadingText || 'Working...';
        }

        cancelBtn.classList.toggle('hidden', request.taskStatus !== 'running');
    }

    function addMessage(message, save = true) {
        const { text, sender } = message;
        const messageElement = document.createElement('div');
        messageElement.className = `flex items-start gap-3 ${sender === 'user' ? 'justify-end' : ''}`;

        const iconClass = sender === 'user' ? 'bg-blue-600' : 'bg-gray-600';
        const iconSvg = sender === 'user' 
            ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"></path></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path d="M12.0006 18.26L4.94715 22.2082L6.52248 14.2799L0.587891 8.7918L8.61483 7.84006L12.0006 0.5L15.3864 7.84006L23.4133 8.7918L17.4787 14.2799L19.054 22.2082L12.0006 18.26Z"></path></svg>`;

        const bubbleClass = sender === 'user' ? 'chat-bubble-user' : 'chat-bubble-assistant';

        messageElement.innerHTML = `
            <div class="flex-shrink-0 w-8 h-8 rounded-full ${iconClass} flex items-center justify-center text-white ${sender === 'user' ? 'order-2' : 'order-1'}">
                ${iconSvg}
            </div>
            <div class="max-w-xs ${sender === 'user' ? 'order-1' : 'order-2'}">
                <div class="px-4 py-2 rounded-lg ${bubbleClass}">
                    <!-- Content will be injected here -->
                </div>
                <p class="text-xs text-gray-500 mt-1 px-1">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
        `;
        
        const bubbleContent = messageElement.querySelector('.px-4.py-2');
        const textP = document.createElement('p');
        textP.className = 'text-sm text-gray-100 whitespace-pre-wrap';

        // --- NEW: Logic to render code blocks ---
        if (text.includes('```javascript')) {
            const [reasonPart, ...codeParts] = text.split('```javascript');
            const code = codeParts.join('```javascript').split('```')[0].trim();
            
            textP.textContent = reasonPart.trim();
            bubbleContent.innerHTML = ''; // Clear existing
            bubbleContent.appendChild(textP);
            
            const codeContainer = document.createElement('div');
            codeContainer.className = 'mt-2 bg-gray-900 rounded-md p-2 relative';
            codeContainer.innerHTML = `
                <pre class="text-xs text-gray-300 overflow-x-auto"><code></code></pre>
                <button class="copy-code-btn absolute top-1 right-1 bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 text-xs rounded">Copy</button>
            `;
            codeContainer.querySelector('code').textContent = code; // Safely set code text
            bubbleContent.appendChild(codeContainer);
            
        } else {
            textP.textContent = text;
            bubbleContent.innerHTML = '';
            bubbleContent.appendChild(textP);
        }

        chatContainer.appendChild(messageElement);
        chatContainer.scrollTop = chatContainer.scrollHeight;

        if (save) {
            saveChatHistory();
        }
    }

    function saveChatHistory() {
        chrome.storage.local.get([CHAT_HISTORY_KEY], (result) => {
            const history = result[CHAT_HISTORY_KEY] || [];
            const lastMessageText = chatContainer.lastChild.querySelector('.px-4.py-2').textContent; // Simplified for storage
            const lastMessage = { 
                text: lastMessageText,
                sender: chatContainer.lastChild.querySelector('.order-2') ? 'user' : 'assistant'
            };
            history.push(lastMessage);
            chrome.storage.local.set({ [CHAT_HISTORY_KEY]: history });
        });
    }

    function loadChatHistory() {
        chrome.storage.local.get([CHAT_HISTORY_KEY], (result) => {
            const history = result[CHAT_HISTORY_KEY];
            if (history && history.length > 0) {
                history.forEach(msg => addMessage(msg, false));
            } else {
                addMessage({ text: 'Hello! How can I help you automate tasks on this page?', sender: 'assistant' }, false);
            }
        });
    }
});

