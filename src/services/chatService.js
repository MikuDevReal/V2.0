let publicMessages = [];

exports.addMessage = (username, message) => {
    const newMessage = {
        username: username,
        message: message,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: Date.now()
    };
    
    publicMessages.push(newMessage);
    
    if (publicMessages.length > 100) {
        publicMessages.shift();
    }
    
    return newMessage;
};

exports.getMessages = () => {
    return publicMessages;
};