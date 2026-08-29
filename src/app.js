const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const whatsappRoutes = require('./routes/whatsapp');
const vpsRoutes = require('./routes/vps');
const toolsRoutes = require('./routes/tools');
const chatRoutes = require('./routes/chat');

// Import middleware
const authMiddleware = require('./middleware/authMiddleware');
const rateLimitMiddleware = require('./middleware/rateLimitMiddleware');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());

// Body parser middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Rate limiting
app.use(rateLimitMiddleware);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', authMiddleware, userRoutes);
app.use('/api/whatsapp', authMiddleware, whatsappRoutes);
app.use('/api/vps', authMiddleware, vpsRoutes);
app.use('/api/tools', authMiddleware, toolsRoutes);
app.use('/', chatRoutes);

// Health check
app.get('/ping', (req, res) => res.send('pong'));

module.exports = app;