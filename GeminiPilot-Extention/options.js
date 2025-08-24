document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('api-key-input');
    const saveBtn = document.getElementById('save-btn');
    const statusEl = document.getElementById('status');

    // Load the saved API key when the options page is opened
    const restoreOptions = () => {
        chrome.storage.local.get(['apiKey'], (result) => {
            if (result.apiKey) {
                apiKeyInput.value = result.apiKey;
            }
        });
    };

    // Save the API key to chrome.storage
    const saveOptions = () => {
        const apiKey = apiKeyInput.value.trim();
        if (apiKey) {
            chrome.storage.local.set({ apiKey: apiKey }, () => {
                statusEl.textContent = 'API Key saved!';
                setTimeout(() => {
                    statusEl.textContent = '';
                }, 2000);
            });
        }
    };

    restoreOptions();
    saveBtn.addEventListener('click', saveOptions);
});