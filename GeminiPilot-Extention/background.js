// Please visit readme.md for setup instructions and details.
let taskState = {
    isRunning: false,
    originalPrompt: null,
    tabId: null,
};

// Main message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'START_TASK') {
        if (taskState.isRunning) {
            console.warn("A task is already in progress.");
            updatePopup({ message: "A task is already running. Please wait or cancel.", loading: false });
            return;
        }
        runTask(request.prompt);
    } else if (request.type === 'CANCEL_TASK') {
        taskState.isRunning = false;
        updatePopup({ message: "Task cancelled.", loading: false, taskStatus: 'idle' });
    }
});

async function runTask(prompt) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
        updatePopup({ message: "Error: No active tab found.", loading: false, taskStatus: 'idle' });
        return;
    }

    taskState.isRunning = true;
    taskState.originalPrompt = prompt;
    taskState.tabId = tab.id;

    try {
        updatePopup({ loading: true, loadingText: "Analyzing the page...", taskStatus: 'running' });
        const injectionResults = await chrome.scripting.executeScript({
            target: { tabId: taskState.tabId },
            func: getPageContent,
        });
        const pageContent = injectionResults[0].result;

        updatePopup({ loading: true, loadingText: "Generating automation script...", taskStatus: 'running' });
        const result = await callGeminiApi(prompt, pageContent, tab.url);

        if (!taskState.isRunning) return;

        await executeFinalAction(result);

    } catch (error) {
        console.error("Error in runTask:", error);
        updatePopup({ message: `Error: ${error.message}`, loading: false, taskStatus: 'idle' });
    } finally {
        taskState.isRunning = false;
    }
}

async function executeFinalAction(action) {
    let finalMessage = "Task finished.";

    if (action.action === 'manual_script') {
        // Format the detailed instructions for the user to paste in the console
        finalMessage = `${action.reason}\n\n**1. Open Developer Console:**\nPress \`F12\` or \`(Ctrl+Shift+I / Cmd+Opt+I)\`.\n\n**2. Paste the Code:**\nClick the 'Copy' button below and paste the entire script into the console.\n\n**3. Run It:**\nPress \`Enter\`. The script will start running on the page.\n\n\`\`\`javascript\n${action.code}\n\`\`\``;

    } else if (action.action === 'execute_script') {
        // This is now a fallback for sites without strict CSP
        await chrome.scripting.executeScript({
            target: { tabId: taskState.tabId },
            world: 'MAIN',
            func: (scriptCode) => {
                try {
                    const script = document.createElement('script');
                    script.textContent = scriptCode;
                    (document.head || document.documentElement).appendChild(script);
                    script.remove();
                } catch (e) { console.error("Error injecting script tag:", e); }
            },
            args: [action.code],
        });
        finalMessage = `${action.reason}. The script has been injected and is now running. Check the developer console (F12) for progress.`;

    } else if (action.action === 'finish') {
        finalMessage = action.summary;
    } else {
        // Fallback for extremely simple, single-step actions
        const [injectionResult] = await chrome.scripting.executeScript({
            target: { tabId: taskState.tabId },
            func: executeSingleActionOnPage,
            args: [action],
        });
        finalMessage = injectionResult.result || `Simple action '${action.action}' completed.`;
    }

    updatePopup({ message: finalMessage, loading: false, taskStatus: 'idle' });
}


function updatePopup(status) {
    chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', ...status });
}

// --- Injected Functions ---

// --- NEW: Highly optimized function to get page content ---
function getPageContent() {
    // This function runs on the target page to extract a highly optimized summary of the DOM.
    const importantSelectors = [
        'a[href]', 
        'button', 
        'input:not([type="hidden"])', 
        'textarea', 
        'select', 
        '[role="button"]', 
        '[role="link"]', 
        '[role="menuitem"]', 
        '[aria-label]:not([aria-label=""])'
    ];
    let content = `URL: ${document.URL}\nTitle: ${document.title}\n\n--- Interactive Elements ---\n`;
    
    // Use a Set to avoid duplicating elements found by multiple selectors
    const elements = new Set(document.querySelectorAll(importantSelectors.join(',')));

    for (const el of elements) {
        // Stop if we're nearing the character limit to avoid abrupt truncation
        if (content.length > 7500) {
            content += "\n... (Content truncated to avoid exceeding limits)";
            break;
        }

        let elementInfo = `<${el.tagName.toLowerCase()}`;
        
        // Add key attributes for identification
        const id = el.id;
        if (id) elementInfo += ` id="${id}"`;

        const name = el.name;
        if (name) elementInfo += ` name="${name}"`;
        
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) elementInfo += ` aria-label="${ariaLabel}"`;

        const role = el.getAttribute('role');
        if (role) elementInfo += ` role="${role}"`;

        // Extract a short, relevant text snippet, cleaning up whitespace
        const text = (el.textContent || el.value || el.innerText || "").trim().substring(0, 60);
        
        elementInfo += `>${text ? text.replace(/\s+/g, ' ') : ''}</${el.tagName.toLowerCase()}>`;
        
        content += elementInfo + '\n';
    }
    
    // Final hard limit
    return content.substring(0, 8000); 
}


async function callGeminiApi(originalPrompt, pageContent, currentUrl) {
    const data = await chrome.storage.local.get(['apiKey']);
    const apiKey = data.apiKey;
    
    if (!apiKey) {
      console.error("Gemini API key not found.");
      return { action: "finish", summary: "API key not set. Please right-click the extension icon, go to 'Options', and set your Gemini API key." };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
    const systemInstruction = `You are an expert web automation scripter. Your primary goal is to achieve a user's objective by writing a single, self-contained JavaScript snippet. You will receive the user's goal, the current URL, and a simplified HTML structure of the page. Your response must be a single JSON object.

**CRITICAL CSP AWARENESS**
Some websites like Facebook have a strict Content Security Policy (CSP) that will block direct script injection.

- **IF the current URL contains 'facebook.com' OR you suspect a strict CSP, you MUST use the "manual_script" action.** This provides the user with code to paste into their console.
- **Otherwise, you can use the default "execute_script" action for direct injection.**

**JSON Response Formats:**

**1. For Strict CSP Sites (e.g., Facebook):**
{
  "action": "manual_script",
  "code": "JAVASCRIPT_CODE_STRING",
  "reason": "A user-friendly explanation of what the script does and that manual execution is needed due to the site's security."
}

**2. For Standard Sites (Default):**
{
  "action": "execute_script",
  "code": "JAVASCRIPT_CODE_STRING",
  "reason": "A brief explanation of what the script will do."
}

**RULES FOR WRITING SCRIPTS (Apply to both formats):**
1.  **Self-Contained:** The code MUST be an IIFE (Immediately Invoked Function Expression), like \`(async () => { /* your code here */ })();\` to avoid conflicts with the host page's scripts.
2.  **Use Delays:** THIS IS CRITICAL. Web pages need time to react. You MUST include delays between actions. A good pattern is \`const delay = ms => new Promise(res => setTimeout(res, ms));\` and then using \`await delay(2000);\` after clicks or before checking for new elements.
3.  **Robust Selectors:** Use specific and stable selectors. Prefer \`[aria-label="..."]\`, \`[data-testid="..."]\`, or IDs. Avoid highly generic or auto-generated class names.
4.  **User Feedback:** Your script MUST log its progress to the console. Use \`console.log()\` to announce major steps, successes, or failures (e.g., \`console.log("✅ Clicking 'Next' button...");\`, \`console.log("🛑 Could not find login form.");\`). This is the user's only way of knowing what's happening.
5.  **Error Handling:** Check if elements exist before interacting with them (e.g., \`if (element) { element.click(); }\`). If a critical element isn't found, log an error and stop gracefully.
6.  **Loops & Limits:** For repetitive actions, use loops (e.g., \`for\`, \`for...of\`). Include a reasonable safety limit (e.g., \`maxItems = 100\`) to prevent infinite loops.

**FALLBACK ACTIONS (Use only if a script is truly unnecessary):**
- {"action": "finish", "summary": "Message to the user if the task is already done or cannot be done."}
`;
    
    const fullPrompt = `User's Goal: "${originalPrompt}"\n\nCurrent URL: ${currentUrl}\n\n--- Current Page Content ---\n${pageContent}`;
    const payload = {
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { responseMimeType: "application/json" }
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`API Error: ${response.status} - ${errorBody}`);
        }

        const result = await response.json();

        if (!result.candidates || !result.candidates[0].content || !result.candidates[0].content.parts) {
            console.error("Invalid API response structure:", result);
            if (result.candidates && result.candidates[0].finishReason === 'SAFETY') {
                 throw new Error("The request was blocked for safety reasons. Please adjust your prompt.");
            }
            throw new Error("Received an invalid or empty response from the API.");
        }
        
        const jsonText = result.candidates[0].content.parts[0].text;
        return JSON.parse(jsonText);

    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error("API request timed out after 25 seconds. The server might be busy. The page content has been simplified; please try again.");
        }
        throw error;
    }
}

// Injected function for simple, one-off actions.
function executeSingleActionOnPage(action) {
    try {
        const element = action.selector ? document.querySelector(action.selector) : null;
        if (!element && !['navigate', 'finish'].includes(action.action)) {
            return `Error: Element not found for selector: ${action.selector}`;
        }
        switch (action.action) {
            case 'fill':
                element.value = action.value;
                return `Filled element ${action.selector}`;
            case 'click':
                element.click();
                return `Clicked element ${action.selector}`;
            case 'navigate':
                window.location.href = action.url;
                return `Navigating to ${action.url}`;
        }
    } catch (error) {
        return `Error executing action: ${error.message}`;
    }
}

// Visit cyberscap.com for more AI tools and resources!

