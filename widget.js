(function() {
    if (window.__medsphereWidgetLoaded) return;
    window.__medsphereWidgetLoaded = true;

    // 1. Inject Styles
    const style = document.createElement("style");
    style.innerHTML = `
        .medsphere-chat-widget {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 999999;
            font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
        }
        .medsphere-launcher {
            width: 56px;
            height: 56px;
            border-radius: 28px;
            background: linear-gradient(135deg, #0d9488, #0f766e);
            box-shadow: 0 4px 16px rgba(13, 148, 136, 0.4);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            border: 2px solid rgba(255, 255, 255, 0.1);
        }
        .medsphere-launcher:hover {
            transform: scale(1.1);
            box-shadow: 0 6px 24px rgba(13, 148, 136, 0.5);
        }
        .medsphere-launcher svg {
            width: 26px;
            height: 26px;
            fill: none;
            stroke: #ffffff;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        .medsphere-chat-box {
            width: 360px;
            height: auto;
            max-height: 500px;
            background: #0f172a;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 24px;
            box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
            margin-bottom: 16px;
            display: none;
            flex-direction: column;
            overflow: hidden;
            animation: medsphereSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            max-width: calc(100vw - 48px);
        }
        @keyframes medsphereSlideIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .medsphere-chat-header {
            background: linear-gradient(135deg, #131d35, #0f172a);
            padding: 16px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .medsphere-header-info {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .medsphere-bot-avatar {
            width: 36px;
            height: 36px;
            border-radius: 18px;
            background: rgba(13, 148, 136, 0.2);
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid rgba(13, 148, 136, 0.4);
            color: #0d9488;
            font-weight: bold;
            font-size: 14px;
        }
        .medsphere-title-wrapper {
            display: flex;
            flex-direction: column;
        }
        .medsphere-title {
            color: #ffffff;
            font-size: 14px;
            font-weight: 700;
            margin: 0;
            line-height: 1.2;
        }
        .medsphere-status {
            color: #10b981;
            font-size: 10px;
            display: flex;
            align-items: center;
            gap: 4px;
            margin-top: 2px;
        }
        .medsphere-status-dot {
            width: 6px;
            height: 6px;
            background: #10b981;
            border-radius: 3px;
            animation: medspherePulse 1.5s infinite;
        }
        @keyframes medspherePulse {
            0% { transform: scale(0.9); opacity: 0.6; }
            50% { transform: scale(1.2); opacity: 1; }
            100% { transform: scale(0.9); opacity: 0.6; }
        }
        .medsphere-close-btn {
            background: none;
            border: none;
            color: #94a3b8;
            cursor: pointer;
            padding: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.2s;
        }
        .medsphere-close-btn:hover {
            color: #ffffff;
        }
        .medsphere-chat-messages {
            max-height: 380px;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            background: #090d16;
        }
        .medsphere-msg {
            max-width: 80%;
            padding: 10px 14px;
            border-radius: 16px;
            font-size: 12.5px;
            line-height: 1.45;
            word-wrap: break-word;
        }
        .medsphere-msg.incoming {
            background: rgba(255, 255, 255, 0.05);
            color: #f3f4f6;
            align-self: flex-start;
            border-bottom-left-radius: 4px;
            border: 1px solid rgba(255, 255, 255, 0.03);
        }
        .medsphere-msg.outgoing {
            background: #0d9488;
            color: #ffffff;
            align-self: flex-end;
            border-bottom-right-radius: 4px;
            box-shadow: 0 2px 8px rgba(13, 148, 136, 0.2);
        }
        .medsphere-chat-input-area {
            padding: 12px 16px;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
            background: #0f172a;
            display: flex;
            gap: 8px;
        }
        .medsphere-chat-input {
            flex: 1;
            background: #090d16;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 10px 14px;
            color: #ffffff;
            font-size: 13px;
            outline: none;
            transition: border-color 0.2s;
        }
        .medsphere-chat-input:focus {
            border-color: #0d9488;
        }
        .medsphere-send-btn {
            background: #0d9488;
            border: none;
            border-radius: 12px;
            width: 38px;
            height: 38px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: opacity 0.2s;
            color: #ffffff;
        }
        .medsphere-send-btn:hover {
            opacity: 0.9;
        }
    `;
    document.head.appendChild(style);

    // 2. Render Widget HTML
    const widgetContainer = document.createElement("div");
    widgetContainer.className = "medsphere-chat-widget";
    widgetContainer.innerHTML = `
        <div class="medsphere-chat-box" id="medsphereChatBox">
            <div class="medsphere-chat-header">
                <div class="medsphere-header-info">
                    <div class="medsphere-bot-avatar">M</div>
                    <div class="medsphere-title-wrapper">
                        <span class="medsphere-title">MedSphere AI Receptionist</span>
                        <div class="medsphere-status">
                            <span class="medsphere-status-dot"></span>
                            <span>Online Advisor</span>
                        </div>
                    </div>
                </div>
                <button class="medsphere-close-btn" id="medsphereCloseBtn">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div class="medsphere-chat-messages" id="medsphereChatMessages">
                <div class="medsphere-msg incoming">
                    Hello! I am your MedSphere AI assistant. How can I help you today? You can ask me about symptoms, services, or bookings!
                </div>
            </div>
            <form class="medsphere-chat-input-area" id="medsphereChatForm">
                <input type="text" class="medsphere-chat-input" id="medsphereChatInput" placeholder="Ask MedSphere AI..." required>
                <button type="submit" class="medsphere-send-btn">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13"></line>
                        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                </button>
            </form>
        </div>
        <div class="medsphere-launcher" id="medsphereLauncher">
            <svg viewBox="0 0 24 24">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
        </div>
    `;
    document.body.appendChild(widgetContainer);

    // 3. Controller Actions
    const launcher = document.getElementById("medsphereLauncher");
    const chatBox = document.getElementById("medsphereChatBox");
    const closeBtn = document.getElementById("medsphereCloseBtn");
    const chatForm = document.getElementById("medsphereChatForm");
    const chatInput = document.getElementById("medsphereChatInput");
    const chatMessages = document.getElementById("medsphereChatMessages");

    let chatHistory = [];
    const API_HOST = window.location.origin.includes("localhost") || window.location.origin.includes("127.0.0.1") 
        ? window.location.origin 
        : "https://hospital.technocons.com";

    launcher.addEventListener("click", () => {
        const isVisible = chatBox.style.display === "flex";
        chatBox.style.display = isVisible ? "none" : "flex";
        if (!isVisible) {
            chatInput.focus();
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    });

    closeBtn.addEventListener("click", () => {
        chatBox.style.display = "none";
    });

    chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const query = chatInput.value.trim();
        if (!query) return;

        // Remove quick actions container on first message
        const qa = document.getElementById("medsphereQuickActions");
        if (qa) qa.remove();

        // Append user message
        appendMessage("outgoing", query);
        chatInput.value = "";

        // Typing indicator
        const typingEl = document.createElement("div");
        typingEl.className = "medsphere-msg incoming";
        typingEl.innerHTML = "<em>MedSphere AI is typing...</em>";
        chatMessages.appendChild(typingEl);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // Fetch query from backend
        fetch(`${API_HOST}/api/patient-chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: query, history: chatHistory })
        })
        .then(res => res.json())
        .then(data => {
            typingEl.remove();
            if (data.success && data.analysis) {
                appendMessage("incoming", data.analysis);
                // Save context history
                chatHistory.push({ role: "user", text: query });
                chatHistory.push({ role: "model", text: data.analysis });
            } else {
                appendMessage("incoming", "I'm sorry, I encountered an issue processing your request. Please schedule a consultation with our clinicians.");
            }
        })
        .catch(err => {
            console.error("Widget chat error:", err);
            typingEl.remove();
            appendMessage("incoming", "I describe standard clinical support offline. If you have an emergency, please visit the hospital directly.");
        });
    });


    function appendMessage(sender, text) {
        const msg = document.createElement("div");
        msg.className = `medsphere-msg ${sender}`;
        
        // Basic markdown parser
        msg.innerHTML = text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
            
        chatMessages.appendChild(msg);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
})();
