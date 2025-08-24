// Please visit readme.md for setup instructions and details.
let taskState = {
    isRunning: false,
    originalPrompt: null,
    history: [],
    tabId: null,
    waitingForUpdate: false,
};

// Main message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'START_TASK') {
        if (taskState.isRunning) {
            console.warn("A task is already in progress.");
            return;
        }
        initializeTask(request.prompt);
    } else if (request.type === 'CANCEL_TASK') {
        cancelTask();
    }
});

function cancelTask() {
    if (taskState.isRunning) {
        taskState.isRunning = false;
        taskState.waitingForUpdate = false;
        chrome.alarms.clearAll();
        chrome.tabs.onUpdated.removeListener(tabUpdateListener);
        console.log("Task cancelled by user.");
        updatePopup({ 
            message: "Task cancelled.", 
            loading: false, 
            taskStatus: 'idle' 
        });
    }
}

async function initializeTask(prompt) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
        updatePopup({ message: "Error: No active tab found.", loading: false, taskStatus: 'idle' });
        return;
    }

    taskState = {
        isRunning: true,
        originalPrompt: prompt,
        history: [`User's goal: ${prompt}`],
        tabId: tab.id,
        waitingForUpdate: false,
    };

    updatePopup({ loading: true, loadingText: "Starting...", taskStatus: 'running' });
    taskLoop();
}

async function taskLoop() {
    if (!taskState.isRunning) {
        console.log("Task loop stopped.");
        return;
    }

    try {
        updatePopup({ loading: true, loadingText: "Reading the page...", taskStatus: 'running' });
        const injectionResults = await chrome.scripting.executeScript({
            target: { tabId: taskState.tabId },
            func: getPageContent,
        });
        const pageContent = injectionResults[0].result;

        const historySummary = [taskState.history[0]];
        if (taskState.history.length > 1) {
            historySummary.push(...taskState.history.slice(-4)); 
        }

        updatePopup({ loading: true, loadingText: "Deciding next action...", taskStatus: 'running' });
        const result = await callGeminiApi(taskState.originalPrompt, historySummary, pageContent);

        if (!taskState.isRunning) return;

        if (result.action === "finish") {
            taskState.isRunning = false;
            updatePopup({ message: result.summary || "Task finished!", loading: false, taskStatus: 'idle' });
        } else {
            taskState.history.push(`Assistant's next action: ${JSON.stringify(result)}`);
            updatePopup({ message: `Action: ${result.action} on "${result.selector || result.url}"`, loading: true, loadingText: "Executing...", taskStatus: 'running' });

            const actionResult = await executeAction(result);
            if (!taskState.isRunning) return;

            taskState.history.push(`Action result: ${actionResult || "No result"}`);
            
            waitForNextStep(result.action);
        }
    } catch (error) {
        console.error("Error in task loop:", error);
        updatePopup({ message: `Error: ${error.message}`, loading: false, taskStatus: 'idle' });
        taskState.isRunning = false;
    }
}

function waitForNextStep(actionType) {
    if (['click', 'fill', 'navigate', 'enter'].includes(actionType)) {
        taskState.waitingForUpdate = true;
        chrome.alarms.create('pageUpdateTimeout', { delayInMinutes: 0.15 }); // 9 seconds
        chrome.tabs.onUpdated.addListener(tabUpdateListener);
    } else {
        chrome.alarms.create('continueTask', { delayInMinutes: 0.05 }); // 3 seconds
    }
}

const tabUpdateListener = (tabId, changeInfo, tab) => {
    if (tabId === taskState.tabId && changeInfo.status === 'complete' && taskState.waitingForUpdate) {
        console.log("Page update complete. Continuing task.");
        taskState.waitingForUpdate = false;
        chrome.alarms.clear('pageUpdateTimeout');
        chrome.tabs.onUpdated.removeListener(tabUpdateListener);
        taskLoop();
    }
};

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'continueTask') {
        taskLoop();
    } else if (alarm.name === 'pageUpdateTimeout') {
        if (taskState.waitingForUpdate) {
            console.warn("Page update timeout reached. Continuing task anyway.");
            taskState.waitingForUpdate = false;
            chrome.tabs.onUpdated.removeListener(tabUpdateListener);
            taskLoop();
        }
    }
});

async function executeAction(action) {
    const [injectionResult] = await chrome.scripting.executeScript({
        target: { tabId: taskState.tabId },
        func: executeActionsOnPage,
        args: [[action]],
    });
    return injectionResult.result;
}

function updatePopup(status) {
    chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', ...status });
}

// --- Injected Functions x1 ---

function getPageContent() {
    const importantTags = ['h1', 'h2', 'h3', 'label', 'button', 'a', 'input', 'textarea', 'select', '[role="button"]', '[aria-label]'];
    let content = `URL: ${document.URL}\nTitle: ${document.title}\n\n`;
    document.querySelectorAll(importantTags.join(',')).forEach(el => {
        let elementInfo = `TAG: ${el.tagName}`;
        if(el.id) elementInfo += `, ID: #${el.id}`;
        const className = (el.className && typeof el.className === 'string') ? el.className : '';
        if(className) elementInfo += `, CLASS: .${className.split(' ').join('.')}`;
        if(el.name) elementInfo += `, NAME: [name="${el.name}"]`;
        if(el.placeholder) elementInfo += `, PLACEHOLDER: "${el.placeholder}"`;
        if(el.getAttribute('aria-label')) elementInfo += `, ARIA-LABEL: "${el.getAttribute('aria-label')}"`;
        const text = (el.textContent || el.value || el.innerText || "").trim();
        if(text) elementInfo += `, TEXT: "${text.substring(0, 150)}"`;
        content += elementInfo + '\n';
    });
    return content.substring(0, 8000);
}

async function callGeminiApi(originalPrompt, historySummary, pageContent) {
    const data = await chrome.storage.local.get(['apiKey']);
    const apiKey = data.apiKey;
    
    if (!apiKey) {
      console.error("Gemini API key not found.");
      return { action: "finish", summary: "API key not set. Please right-click the extension icon, go to 'Options', and set your Gemini API key." };
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
    const systemInstruction = `You are a web automation assistant. Your goal is to achieve the user's objective by breaking it down into a sequence of single actions. You will be given the user's overall goal, a summary of the most recent actions, and the current state of the web page. Your response must be a single JSON object representing the *next* action to take.
Possible actions are:
1. {"action": "fill", "selector": "CSS_SELECTOR", "value": "text to fill", "reason": "Why you are filling this field."}
2. {"action": "click", "selector": "CSS_SELECTOR", "reason": "Why you are clicking this element."}
3. {"action": "enter", "selector": "CSS_SELECTOR", "reason": "Why you are simulating an Enter key press on this element."}
4. {"action": "read", "selector": "CSS_SELECTOR", "reason": "What information you are trying to extract."}
5. {"action": "navigate", "url": "URL_TO_GO_TO", "reason": "Why you are navigating to this URL."}
6. {"action": "finish", "summary": "A summary of the results or a confirmation that the task is complete."}
Analyze the history summary and page content to decide the next logical step. If the user's goal is achieved, respond with the "finish" action. Be precise with your CSS selectors. Use IDs, aria-labels, and descriptive attributes whenever possible.`;
    const fullPrompt = `User's Goal: ${originalPrompt}\n\nRecent History:\n${historySummary.join('\n')}\n\nCurrent Page Content:\n${pageContent}`;
    const payload = {
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { responseMimeType: "application/json" }
    };
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API Error: ${response.status} - ${errorBody}`);
    }
    const result = await response.json();
    const jsonText = result.candidates[0].content.parts[0].text;
    return JSON.parse(jsonText);
}

function executeActionsOnPage(actions) {
    const action = actions[0];
    try {
        const element = action.selector ? document.querySelector(action.selector) : null;
        if (!element && !['navigate', 'finish'].includes(action.action)) {
            return `Error: Element not found for selector: ${action.selector}`;
        }
        switch (action.action) {
            case 'fill':
                element.value = action.value;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                return `Filled element ${action.selector} with "${action.value}"`;
            case 'click':
                element.click();
                return `Clicked element ${action.selector}`;
            case 'enter':
                element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', which: 13, keyCode: 13, bubbles: true }));
                element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', which: 13, keyCode: 13, bubbles: true }));
                return `Pressed Enter on element ${action.selector}`;
            case 'read':
                return `Read text from ${action.selector}: "${(element.textContent || element.innerText || element.value).trim()}"`;
            case 'navigate':
                window.location.href = action.url;
                return `Navigating to ${action.url}`;
            case 'finish':
                return "Finish action received.";
        }
    } catch (error) {
        return `Error executing action: ${error.message}`;
    }
}

// Visit cyberscap.com for more AI tools and resources!