const WebSocket = require('ws');
const User = require('../models/user');
const Tab = require('../models/tab');
const Shortcut = require('../models/shortcut');
const History = require('../models/history');
const Bookmark = require('../models/bookmark');
const Note = require('../models/note');
const logger = require('./logger');

let wss;

// 📌 Initialize WebSocket Server
const initializeWebSocketServer = (server) => {
    wss = new WebSocket.Server({ server });
    logger.info('WebSocket server initialized');

    wss.on('connection', (ws) => {
        logger.info('New WebSocket connection established');

        let debounceTimer;

        ws.on('message', async (message) => {
            try {
                const { action, sessionToken, username, data } = JSON.parse(message);

                // Validate mandatory fields
                if (!sessionToken || !username) {
                    logger.error('Missing sessionToken or username.');
                    return ws.send(JSON.stringify({ status: 'error', message: 'Missing sessionToken or username' }));
                }

                if (debounceTimer) clearTimeout(debounceTimer);

                debounceTimer = setTimeout(async () => {
                    const user = await User.findOne({ username });

                    if (!user) {
                        ws.send(JSON.stringify({ status: 'logout', message: 'User not found' }));
                        logger.warn(`User ${username} not found, triggering logout.`);
                        return;
                    }

                    if (user.sessionToken !== sessionToken) {
                        logger.warn(`Session mismatch detected for user ${username}.`);
                        user.sessionToken = null;  // Invalidate session token
                        await user.save();
                        ws.send(JSON.stringify({ status: 'logout', message: 'Session mismatch detected' }));
                        broadcastToUser(username, { action: 'logout', message: 'Session mismatch' });
                        return;
                    }

                    if (!user.sessionToken) {
                        logger.warn(`Session token missing for user ${username}, triggering logout.`);
                        ws.send(JSON.stringify({ status: 'logout', message: 'Session token missing' }));
                        broadcastToUser(username, { action: 'logout', message: 'Session token missing' });
                        return;
                    }


                    ws.username = username; // Store username in WebSocket connection
                    ws.send(JSON.stringify({ status: 'valid', message: 'Session verified' }));
                }, 1000);


                // 🟢 Handle tab-related actions
                switch (action) {
                    case 'createTab':
                        await handleCreateTab(ws, sessionToken, username, data);
                        break;
                    case 'closeTab':
                        await handleCloseTab(ws, sessionToken, username, data.id);
                        break;
                    case 'groupTab':
                        await handleGroupTab(ws, sessionToken, username, data.id, data.newGroup);
                        break;
                    case 'getTabs':
                        await handleGetTabs(ws, sessionToken, username);
                        break;

                    // 🟢 Handle new features
                    case 'addShortcut':
                        await handleAddShortcut(ws, sessionToken, username, data);
                        break;
                    case 'getShortcuts':
                        await handleGetShortcuts(ws, sessionToken, username);
                        break;
                    case 'deleteShortcut':
                        await handleDeleteShortcut(ws, sessionToken, username, data.id);
                        break;

                    case 'addHistory':
                        await handleAddHistory(ws, sessionToken, username, data);
                        break;
                    case 'getHistory':
                        await handleGetHistory(ws, sessionToken, username);
                        break;
                    case 'deleteHistory':
                        await handleDeleteHistory(ws, sessionToken, username);
                        break;

                    case 'addBookmark':
                        await handleAddBookmark(ws, sessionToken, username, data);
                        break;
                    case 'updateBookmark':
                        await handleUpdateBookmark(ws, sessionToken, username, data);
                        break;
                    case 'deleteBookmark':
                        await handleDeleteBookmark(ws, sessionToken, username, data.id);
                        break;
                    case 'getBookmarks':
                        await handleGetBookmarks(ws, sessionToken, username);
                        break;

                    case 'addNote':
                        await handleAddNote(ws, sessionToken, username, data);
                        break;
                    case 'updateNote':
                        await handleUpdateNote(ws, sessionToken, username, data);
                        break;
                    case 'deleteNote':
                        await handleDeleteNote(ws, sessionToken, username, data.id);
                        break;
                    case 'getNotes':
                        await handleGetNotes(ws, sessionToken, username);
                        break;

                    default:
                        logger.warn(`Unknown action received: ${action}`);
                        ws.send(JSON.stringify({ status: 'error', message: 'Unknown action' }));
                }
            } catch (error) {
                logger.error(`Error processing message: ${error.message}`, error);
                ws.send(JSON.stringify({ status: 'error', message: 'Internal server error' }));
            }
        });

        ws.on('close', () => {
            logger.info('WebSocket connection closed');
        });

        ws.on('error', (error) => {
            logger.error('WebSocket error:', error);
        });

    });
};

// 📌 Broadcast function to update all connected clients of a user
const broadcastToUser = (username, data) => {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.username === username) {
            try {
                client.send(JSON.stringify(data));
            } catch (error) {
                logger.error(`Error broadcasting to user ${username}: ${error.message}`);
            }
        }
    });
};

const handleCreateTab = async (ws, sessionToken, username, tabData) => {
    try {
        const user = await User.findOne({ sessionToken, username });
        if (!user) return ws.send(JSON.stringify({ status: 'logout', message: 'Invalid session' }));

        const newTab = new Tab({ username: user.username, ...tabData, status: 'active' });
        await newTab.save();
        broadcastToUser(user.username, { action: 'tabCreated', tab: newTab });
        logger.info(`Tab created for user ${username}: ${newTab._id}`);
    } catch (error) {
        logger.error(`Error creating tab for user ${username}: ${error.message}`, error);
        ws.send(JSON.stringify({ status: 'error', message: 'Failed to create tab' }));
    }
};

const handleCloseTab = async (ws, sessionToken, username, tabId) => {
    try {
        if (!tabId) {
            logger.warn(`Missing tabId for closeTab action from user ${username}.`);
            return ws.send(JSON.stringify({ status: 'error', message: 'Missing tabId' }));
        }

        const user = await User.findOne({ sessionToken, username });
        if (!user) return ws.send(JSON.stringify({ status: 'logout', message: 'Invalid session' }));

        const result = await Tab.findOneAndUpdate({ _id: tabId, username: user.username }, { status: 'closed' });
        if (!result) {
            logger.warn(`Tab not found or unauthorized for user ${username}: ${tabId}`);
            return ws.send(JSON.stringify({ status: 'error', message: 'Tab not found or unauthorized' }));
        }

        broadcastToUser(user.username, { action: 'tabClosed', tabId });
        logger.info(`Tab closed for user ${username}: ${tabId}`);
    } catch (error) {
        logger.error(`Error closing tab for user ${username}: ${error.message}`, error);
        ws.send(JSON.stringify({ status: 'error', message: 'Failed to close tab' }));
    }
};

const handleGroupTab = async (ws, sessionToken, username, tabId, newGroup) => {
    try {
        if (!tabId || !newGroup) {
            logger.warn(`Missing tabId or newGroup for groupTab action from user ${username}.`);
            return ws.send(JSON.stringify({ status: 'error', message: 'Missing tabId or newGroup' }));
        }

        const user = await User.findOne({ sessionToken, username });
        if (!user) return ws.send(JSON.stringify({ status: 'logout', message: 'Invalid session' }));

        const result = await Tab.findOneAndUpdate({ _id: tabId, username: user.username }, { group: newGroup });
        if (!result) {
            logger.warn(`Tab not found or unauthorized for user ${username}: ${tabId}`);
            return ws.send(JSON.stringify({ status: 'error', message: 'Tab not found or unauthorized' }));
        }
        broadcastToUser(user.username, { action: 'tabGrouped', tabId, newGroup });
        logger.info(`Tab grouped for user ${username}: ${tabId}, Group: ${newGroup}`);
    } catch (error) {
        logger.error(`Error grouping tab for user ${username}: ${error.message}`, error);
        ws.send(JSON.stringify({ status: 'error', message: 'Failed to group tab' }));
    }
};

const handleGetTabs = async (ws, sessionToken, username) => {
    try {
        const user = await User.findOne({ sessionToken, username });
        if (!user) return ws.send(JSON.stringify({ status: 'logout', message: 'Invalid session' }));

        const tabs = await Tab.find({ username: user.username, status: 'active' });
        ws.send(JSON.stringify({ action: 'restoreTabs', tabs }));
        logger.info(`Tabs retrieved for user ${username}`);
    } catch (error) {
        logger.error(`Error getting tabs for user ${username}: ${error.message}`, error);
        ws.send(JSON.stringify({ status: 'error', message: 'Failed to get tabs' }));
    }
};

// --------------------------------------
// Shortcuts Management
// --------------------------------------
const handleAddShortcut = async (ws, sessionToken, username, shortcutData) => {
    try {
        const user = await User.findOne({ sessionToken, username });
        if (!user) return ws.send(JSON.stringify({ status: 'logout', message: 'Invalid session' }));

        const newShortcut = new Shortcut({ username: user.username, ...shortcutData });
        await newShortcut.save();

        broadcastToUser(user.username, { action: 'shortcutAdded', shortcut: newShortcut });
        logger.info(`Shortcut added for user ${username}: ${newShortcut._id}`);
    } catch (error) {
        logger.error(`Error adding shortcut for user ${username}: ${error.message}`, error);
        ws.send(JSON.stringify({ status: 'error', message: 'Failed to add shortcut' }));
    }
};

const handleGetShortcuts = async (ws, sessionToken, username) => {
    try {
        const user = await User.findOne({ sessionToken, username });
        if (!user) return ws.send(JSON.stringify({ status: 'logout', message: 'Invalid session' }));

        const shortcuts = await Shortcut.find({ username: user.username });
        ws.send(JSON.stringify({ action: 'shortcutsRetrieved', shortcuts }));
        logger.info(`Shortcuts retrieved for user ${username}`);
    } catch (error) {
        logger.error(`Error getting shortcuts for user ${username}: ${error.message}`, error);
        ws.send(JSON.stringify({ status: 'error', message: 'Failed to get shortcuts' }));
    }
};

const handleDeleteShortcut = async (ws, sessionToken, username, shortcutId) => {
    try {
        if (!shortcutId) {
            logger.warn(`Missing shortcutId for deleteShortcut action from user ${username}.`);
            return ws.send(JSON.stringify({ status: 'error', message: 'Missing shortcutId' }));
        }

        const user = await User.findOne({ sessionToken, username });
        if (!user) return ws.send(JSON.stringify({ status: 'logout', message: 'Invalid session' }));

        const result = await Shortcut.findByIdAndDelete(shortcutId);
        if (!result) {
            logger.warn(`Shortcut not found for user ${username}: ${shortcutId}`);
            return ws.send(JSON.stringify({ status: 'error', message: 'Shortcut not found' }));
        }

        broadcastToUser(user.username, { action: 'shortcutDeleted', id: shortcutId });
        logger.info(`Shortcut deleted for user ${username}: ${shortcutId}`);
    } catch (error) {
        logger.error(`Error deleting shortcut for user ${username}: ${error.message}`, error);
        ws.send(JSON.stringify({ status: 'error', message: 'Failed to delete shortcut' }));
    }
};

// --------------------------------------
// History Management
// --------------------------------------
const handleAddHistory = async (ws, sessionToken, username, historyData) => {
    try {
        const user = await User.findOne({ sessionToken, username });
        if (!user) return ws.send(JSON.stringify({ status: 'logout', message: 'Invalid session' }));

        const newHistory = new History({ username: user.username, ...historyData });
        await newHistory.save();
        logger.info(`History added for user ${username}`);
    } catch (error) {
        logger.error(`Error adding history for user ${username}: ${error.message}`, error);
        ws.send(JSON.stringify({ status: 'error', message: 'Failed to add history' }));
    }
};

const handleGetHistory = async (ws, sessionToken, username) => {
    try {
        const user = await User.findOne({ sessionToken, username });
        if (!user) return ws.send(JSON.stringify({ status: 'logout', message: 'Invalid session' }));

        const history = await History.find({ username: user.username });
        ws.send(JSON.stringify({ action: 'historyRetrieved', history }));
        logger.info(`History retrieved for user ${username}`);
    } catch (error) {
        logger.error(`Error getting history for user ${username}: ${error.message}`, error);
        ws.send(JSON.stringify({ status: 'error', message: 'Failed to get history' }));
    }
};

const handleDeleteHistory = async (ws, sessionToken, username) => {
    try {
        const user = await User.findOne({ sessionToken, username });
        if (!user) return ws.send(JSON.stringify({ status: 'logout', message: 'Invalid session' }));

        await History.deleteMany({ username: user.username });
        ws.send(JSON.stringify({ action: 'historyDeleted' }));
        logger.info(`History deleted for user ${username}`);
    } catch (error) {
        logger.error(`Error deleting history for user ${username}: ${error.message}`, error);
        ws.send(JSON.stringify({ status: 'error', message: 'Failed to delete history' }));
    }
};

// --------------------------------------
// Bookmark Management
// --------------------------------------
const handleAddBookmark = async (ws, sessionToken, username, bookmarkData) => {
    try {
        const user = await User.findOne({ sessionToken, username });
        if (!user) return ws.send(JSON.stringify({ status: 'logout', message: 'Invalid session' }));

        const newBookmark = new Bookmark({ username: user.username, ...bookmarkData });
        await newBookmark.save();
        logger.info(`Bookmark added for user ${username}`);
    } catch (error) {
        logger.error(`Error adding bookmark for user ${username}: ${error.message}`, error);
        ws.send(JSON.stringify({ status: 'error', message: 'Failed to add bookmark' }));
    }
};

const handleUpdateBookmark = async (ws, sessionToken, username, bookmarkData) => {
    try {
        if (!bookmarkData || !bookmarkData.id) {
            logger.warn(`Missing bookmarkData or bookmarkData.id for updateBookmark action from user ${username}.`);
            return ws.send(JSON.stringify({ status: 'error', message: 'Missing bookmarkData or bookmarkData.id' }));
        }

        const user = await User.findOne({ sessionToken, username });
        if (!user) return ws.send(JSON.stringify({ status: 'logout', message: 'Invalid session' }));

        const result = await Bookmark.findByIdAndUpdate(bookmarkData.id, bookmarkData);
        if (!result) {
            logger.warn(`Bookmark not found for user ${username}: ${bookmarkData.id}`);
            return ws.send(JSON.stringify({ status: 'error', message: 'Bookmark not found' }));
        }

        logger.info(`Bookmark updated for user ${username}: ${bookmarkData.id}`);
    } catch (error) {
        logger.error(`Error updating bookmark for user ${username}: ${error.message}`, error);
        ws.send(JSON.stringify({ status: 'error', message: 'Failed to update bookmark' }));
    }
};

const handleDeleteBookmark = async (ws, sessionToken, username, bookmarkId) => {
    try {
        if (!bookmarkId) {
            logger.warn(`Missing bookmarkId for deleteBookmark action from user ${username}.`);
            return ws.send(JSON.stringify({ status: 'error', message: 'Missing bookmarkId' }));
        }

        const user = await User.findOne({ sessionToken, username });
        if (!user) return ws.send(JSON.stringify({ status: 'logout', message: 'Invalid session' }));

        const result = await Bookmark.findByIdAndDelete(bookmarkId);
        if (!result) {
            logger.warn(`Bookmark not found for user ${username}: ${bookmarkId}`);
            return ws.send(JSON.stringify({ status: 'error', message: 'Bookmark not found' }));
        }

        logger.info(`Bookmark deleted for user ${username}: ${bookmarkId}`);
    } catch (error) {
        logger.error(`Error deleting bookmark for user ${username}: ${error.message}`, error);
        ws.send(JSON.stringify({ status: 'error', message: 'Failed to delete bookmark' }));
    }
};

const handleGetBookmarks = async (ws, sessionToken, username) => {
    try {
        const user = await User.findOne({ sessionToken, username });
        if (!user) return ws.send(JSON.stringify({ status: 'logout', message: 'Invalid session' }));

        const bookmarks = await Bookmark.find({ username: user.username });
        ws.send(JSON.stringify({ action: 'bookmarksRetrieved', bookmarks }));
        logger.info(`Bookmarks retrieved for user ${username}`);
    } catch (error) {
        logger.error(`Error getting bookmarks for user ${username}: ${error.message}`, error);
        ws.send(JSON.stringify({ status: 'error', message: 'Failed to get bookmarks' }));
    }
};

// --------------------------------------
// Notes Management
// --------------------------------------
const handleAddNote = async (ws, sessionToken, username, noteData) => {
    try {
        const user = await User.findOne({ sessionToken, username });
        if (!user) return ws.send(JSON.stringify({ status: 'logout', message: 'Invalid session' }));

        const newNote = new Note({ username: user.username, ...noteData });
        await newNote.save();
        logger.info(`Note added for user ${username}`);
    } catch (error) {
        logger.error(`Error adding note for user ${username}: ${error.message}`, error);
        ws.send(JSON.stringify({ status: 'error', message: 'Failed to add note' }));
    }
};

const handleUpdateNote = async (ws, sessionToken, username, noteData) => {
    try {
        if (!noteData || !noteData.id) {
            logger.warn(`Missing noteData or noteData.id for updateNote action from user ${username}.`);
            return ws.send(JSON.stringify({ status: 'error', message: 'Missing noteData or noteData.id' }));
        }

        const user = await User.findOne({ sessionToken, username });
        if (!user) return ws.send(JSON.stringify({ status: 'logout', message: 'Invalid session' }));

        const result = await Note.findByIdAndUpdate(noteData.id, noteData);
        if (!result) {
            logger.warn(`Note not found for user ${username}: ${noteData.id}`);
            return ws.send(JSON.stringify({ status: 'error', message: 'Note not found' }));
        }

        logger.info(`Note updated for user ${username}: ${noteData.id}`);
    } catch (error) {
        logger.error(`Error updating note for user ${username}: ${error.message}`, error);
        ws.send(JSON.stringify({ status: 'error', message: 'Failed to update note' }));
    }
};

const handleDeleteNote = async (ws, sessionToken, username, noteId) => {
    try {
        if (!noteId) {
            logger.warn(`Missing noteId for deleteNote action from user ${username}.`);
            return ws.send(JSON.stringify({ status: 'error', message: 'Missing noteId' }));
        }

        const user = await User.findOne({ sessionToken, username });
        if (!user) return ws.send(JSON.stringify({ status: 'logout', message: 'Invalid session' }));

        const result = await Note.findByIdAndDelete(noteId);
        if (!result) {
            logger.warn(`Note not found for user ${username}: ${noteId}`);
            return ws.send(JSON.stringify({ status: 'error', message: 'Note not found' }));
        }

        logger.info(`Note deleted for user ${username}: ${noteId}`);
    } catch (error) {
        logger.error(`Error deleting note for user ${username}: ${error.message}`, error);
        ws.send(JSON.stringify({ status: 'error', message: 'Failed to delete note' }));
    }
};

const handleGetNotes = async (ws, sessionToken, username) => {
    try {
        const user = await User.findOne({ sessionToken, username });
        if (!user) return ws.send(JSON.stringify({ status: 'logout', message: 'Invalid session' }));

        const notes = await Note.find({ username: user.username });
        ws.send(JSON.stringify({ action: 'notesRetrieved', notes }));
        logger.info(`Notes retrieved for user ${username}`);
    } catch (error) {
        logger.error(`Error getting notes for user ${username}: ${error.message}`, error);
        ws.send(JSON.stringify({ status: 'error', message: 'Failed to get notes' }));
    }
};

module.exports = { initializeWebSocketServer };