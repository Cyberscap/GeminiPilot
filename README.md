# GeminiPilot Web Assistant Chrome Extension

An intelligent Chrome extension powered by the Google Gemini API that automates tasks and interacts with web pages based on natural language commands. This assistant can understand multi-step instructions and perform complex actions on your behalf.

## ✨ Features

* **Natural Language Control:** Instruct the extension to perform tasks using plain English (e.g., "Find directions from Colombo to Kandy on this map").
* **🤖 Advanced Script Generation:** For complex or repetitive tasks (e.g., "delete all my posts"), GeminiPilot doesn't just perform single clicks. It writes and executes a complete JavaScript program to automate the entire task in one go. This is incredibly powerful and efficient. For highly secure sites like Facebook, it provides the script for you to run manually from the developer console.
* **Dynamic Page Interaction:**
    * **Fill Forms:** Automatically fills in input fields and text areas.
    * **Click Buttons:** Clicks buttons, links, and other interactive elements.
    * **Press Enter:** Simulates the "Enter" key to submit forms or trigger actions.
    * **Navigate:** Can go to different URLs when instructed.
* **Intelligent Waiting:** Automatically waits for pages to load or update after an action, making it reliable on dynamic websites.
* **Context-Aware:** Keeps a summarized memory of its recent actions to stay on track during long tasks.
* **Secure API Key Storage:** Uses a dedicated options page to securely store your Gemini API key in your browser, not in the code.
* **Modern UI:** A sleek, chat-based interface with persistent conversation history and the ability to cancel ongoing tasks.

## 🚀 How to Run This Extension

Follow these steps to get the Gemini Web Assistant running in your own browser for development.

### Prerequisites

* Google Chrome
* A Gemini API Key from [Google AI Studio](https://aistudio.google.com/app/keys)

### Installation Steps

1.  **Download the Code:**
    * Clone this repository or download the source code as a ZIP file and unzip it.
2.  **Load the Extension in Chrome:**
    * Open Chrome and navigate to `chrome://extensions`.
    * Enable **"Developer mode"** using the toggle switch in the top-right corner.
    * Click the **"Load unpacked"** button.
    * Select the folder containing all the extension files (GeminiPilot-Extention).
    * The "GeminiPilot" should now appear in your extensions list. Pin it to your toolbar for easy access!
4.  **Configure Your API Key:**
    * **This is a crucial step!** The extension will not work without it.
    * Right-click on the extension's icon in your Chrome toolbar.
    * Select **"Options"**.
    * Paste your Gemini API Key into the input field and click **"Save Key"**.
5.  **Start Automating!**
    * Navigate to a website you want to interact with.
    * Click the extension icon to open the chat interface.
    * Give it a command!

## License

This project is open-source and available under the [GNU General Public License v3.0](LICENSE).
