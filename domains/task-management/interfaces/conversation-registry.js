export function createConversationRegistry() {
    const states = new Map();

    return {
        set(userId, owner) {
            states.set(String(userId), owner);
        },
        clear(userId) {
            states.delete(String(userId));
        },
        get(userId) {
            return states.get(String(userId)) || null;
        },
        isBusy(userId) {
            return states.has(String(userId));
        }
    };
}
