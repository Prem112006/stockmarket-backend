const User = require('../models/User');
const Holding = require('../models/Holding');
const Stock = require('../models/Stock');
const Transaction = require('../models/Transaction');
const Feedback = require('../models/Feedback');

// Admin credentials (hardcoded – in production, use env vars)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_TOKEN    = process.env.ADMIN_TOKEN || 'smp-admin-secret-token-2024';

// ── Login ────────────────────────────────────────────────────────────────────
exports.adminLogin = (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    return res.json({ success: true, token: ADMIN_TOKEN, message: 'Admin login successful' });
  }
  return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
};

// ── Auth middleware ───────────────────────────────────────────────────────────
exports.requireAdmin = (req, res, next) => {
  const token = req.headers['x-admin-token'] || req.query.adminToken;
  if (token !== ADMIN_TOKEN) {
    return res.status(403).json({ message: 'Forbidden: Admin access required' });
  }
  next();
};

// ── Dashboard Stats ───────────────────────────────────────────────────────────
exports.getDashboardStats = async (req, res) => {
  try {
    const now = new Date();
    const startOfDay  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - 7);

    // All counts fetched in parallel — no sequential N+1 queries
    const [
      totalUsers,
      newThisWeek,
      totalTrades,
      tradesToday,
      portfolioAgg,
      recentUsers,
      holdingCounts
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: startOfWeek } }),
      Transaction.countDocuments(),
      Transaction.countDocuments({ createdAt: { $gte: startOfDay } }),
      // Single aggregation to get total portfolio value across all users
      Holding.aggregate([
        {
          $lookup: {
            from: 'stocks',
            localField: 'stockId',
            foreignField: '_id',
            as: 'stock'
          }
        },
        { $unwind: { path: '$stock', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: null,
            totalPortValue: {
              $sum: {
                $multiply: [
                  { $ifNull: ['$stock.currentPrice', 0] },
                  { $ifNull: ['$quantity', 0] }
                ]
              }
            }
          }
        }
      ]),
      // Recent 8 users — basic info only
      User.find().sort({ createdAt: -1 }).limit(8).select('-password').lean(),
      // Holding counts grouped by userId — single query instead of N queries
      Holding.aggregate([
        { $group: { _id: '$userId', count: { $sum: 1 } } }
      ])
    ]);

    // Build a fast lookup map for holding counts
    const holdingCountMap = {};
    holdingCounts.forEach(h => { holdingCountMap[String(h._id)] = h.count; });

    const totalPortValue = portfolioAgg[0]?.totalPortValue || 0;

    const recentUsersEnriched = recentUsers.map(u => ({
      id: u._id,
      name: u.name,
      email: u.email,
      balance: u.balance,
      holdingCount: holdingCountMap[String(u._id)] || 0,
      createdAt: u.createdAt
    }));

    return res.json({
      activeNow: global.activeUsersCount || 0,
      totalUsers,
      newThisWeek,
      totalTrades,
      tradesToday,
      totalPortValue,
      recentUsers: recentUsersEnriched
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── All Users ─────────────────────────────────────────────────────────────────
exports.getAllUsers = async (req, res) => {
  try {
    const search = req.query.search || '';
    const filter = search
      ? { $or: [{ name: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }] }
      : {};

    // Fetch users and per-user aggregate counts in parallel
    const [users, holdingCounts, tradeCounts] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).select('-password').lean(),
      // Single aggregation query for all holding counts
      Holding.aggregate([
        { $group: { _id: '$userId', count: { $sum: 1 } } }
      ]),
      // Single aggregation query for all trade counts
      Transaction.aggregate([
        { $group: { _id: '$userId', count: { $sum: 1 } } }
      ])
    ]);

    // Build lookup maps
    const holdingCountMap = {};
    holdingCounts.forEach(h => { holdingCountMap[String(h._id)] = h.count; });

    const tradeCountMap = {};
    tradeCounts.forEach(t => { tradeCountMap[String(t._id)] = t.count; });

    const enriched = users.map(u => ({
      id: u._id,
      name: u.name,
      email: u.email,
      balance: u.balance,
      holdingCount: holdingCountMap[String(u._id)] || 0,
      tradeCount: tradeCountMap[String(u._id)] || 0,
      createdAt: u.createdAt
    }));

    return res.json({ users: enriched, total: enriched.length });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── Single User Detail ────────────────────────────────────────────────────────
exports.getUserDetail = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    const [holdings, transactions] = await Promise.all([
      Holding.find({ userId: user._id }).populate('stockId').lean(),
      Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(50).lean()
    ]);

    const holdingsDetail = holdings.map(h => ({
      symbol: h.stockId?.symbol || '—',
      name: h.stockId?.name || '—',
      quantity: h.quantity,
      currentPrice: h.stockId?.currentPrice || 0,
      value: (h.stockId?.currentPrice || 0) * h.quantity
    }));

    return res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        balance: user.balance,
        createdAt: user.createdAt
      },
      holdings: holdingsDetail,
      transactions
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── Update User Balance ───────────────────────────────────────────────────────
exports.updateUserBalance = async (req, res) => {
  try {
    const { balance } = req.body;
    if (balance == null || isNaN(balance)) return res.status(400).json({ message: 'Valid balance required' });
    const user = await User.findByIdAndUpdate(req.params.id, { balance: Number(balance) }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json({ message: 'Balance updated', user });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── Delete User ───────────────────────────────────────────────────────────────
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    await Promise.all([
      Holding.deleteMany({ userId: req.params.id }),
      Transaction.deleteMany({ userId: req.params.id })
    ]);
    return res.json({ message: 'User deleted successfully' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── All Trades ────────────────────────────────────────────────────────────────
exports.getAllTrades = async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip  = (page - 1) * limit;

    const [trades, total] = await Promise.all([
      Transaction.find().sort({ createdAt: -1 }).skip(skip).limit(limit).populate('userId', 'name email').lean(),
      Transaction.countDocuments()
    ]);

    return res.json({ trades, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── All Watchlists ────────────────────────────────────────────────────────────
exports.getAllWatchlists = async (req, res) => {
  try {
    // Single aggregation — fetch all users with their holdings in one query
    const results = await Holding.aggregate([
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $lookup: {
          from: 'stocks',
          localField: 'stockId',
          foreignField: '_id',
          as: 'stock'
        }
      },
      { $unwind: { path: '$stock', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$userId',
          userName: { $first: '$user.name' },
          userEmail: { $first: '$user.email' },
          stocks: {
            $push: {
              symbol: { $ifNull: ['$stock.symbol', '—'] },
              name: { $ifNull: ['$stock.name', '—'] },
              quantity: '$quantity',
              currentPrice: { $ifNull: ['$stock.currentPrice', 0] }
            }
          }
        }
      },
      { $sort: { userName: 1 } },
      { $limit: 100 }
    ]);

    return res.json({
      watchlists: results.map(r => ({
        userId: r._id,
        userName: r.userName,
        userEmail: r.userEmail,
        stocks: r.stocks
      }))
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── All Portfolios ────────────────────────────────────────────────────────────
exports.getAllPortfolios = async (req, res) => {
  try {
    // Single aggregation — fetch all users with portfolio calculations at DB level
    const portfolios = await User.aggregate([
      {
        $lookup: {
          from: 'holdings',
          localField: '_id',
          foreignField: 'userId',
          as: 'holdings'
        }
      },
      {
        $lookup: {
          from: 'stocks',
          localField: 'holdings.stockId',
          foreignField: '_id',
          as: 'stocks'
        }
      },
      {
        $addFields: {
          holdingsCount: { $size: '$holdings' },
          portfolioValue: {
            $reduce: {
              input: '$holdings',
              initialValue: 0,
              in: {
                $add: [
                  '$$value',
                  {
                    $multiply: [
                      {
                        $ifNull: [
                          {
                            $let: {
                              vars: {
                                stock: {
                                  $arrayElemAt: [
                                    {
                                      $filter: {
                                        input: '$stocks',
                                        as: 's',
                                        cond: { $eq: ['$$s._id', '$$this.stockId'] }
                                      }
                                    },
                                    0
                                  ]
                                }
                              },
                              in: '$$stock.currentPrice'
                            }
                          },
                          0
                        ]
                      },
                      { $ifNull: ['$$this.quantity', 0] }
                    ]
                  }
                ]
              }
            }
          }
        }
      },
      {
        $project: {
          password: 0,
          holdings: 0,
          stocks: 0
        }
      },
      { $sort: { balance: -1 } }
    ]);

    const mapped = portfolios.map(u => ({
      userId: u._id,
      userName: u.name,
      userEmail: u.email,
      balance: u.balance,
      portfolioValue: u.portfolioValue || 0,
      totalValue: (u.balance || 0) + (u.portfolioValue || 0),
      holdingsCount: u.holdingsCount || 0
    }));

    return res.json({ portfolios: mapped });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── System Stats ──────────────────────────────────────────────────────────────
exports.getSystemStats = async (req, res) => {
  try {
    const [totalStocks, totalHoldings] = await Promise.all([
      Stock.countDocuments(),
      Holding.countDocuments()
    ]);
    return res.json({ totalStocks, totalHoldings, uptime: process.uptime() });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── Submit Feedback (Public) ───────────────────────────────────────────────────
exports.submitFeedback = async (req, res) => {
  try {
    const { name, email, type, rating, subject, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ message: 'Name, email, and message are required.' });
    }
    const fb = await Feedback.create({ name, email, type, rating, subject, message });
    return res.json({ success: true, message: 'Your message has been sent!', id: fb._id });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── Get All Feedbacks (Admin) ─────────────────────────────────────────────────
exports.getFeedbacks = async (req, res) => {
  try {
    const filter = {};
    if (req.query.type) filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;
    const feedbacks = await Feedback.find(filter).sort({ createdAt: -1 }).lean();
    const unreadCount = await Feedback.countDocuments({ status: 'unread' });
    return res.json({ feedbacks, total: feedbacks.length, unreadCount });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── Update Feedback Status (Admin) ────────────────────────────────────────────
exports.updateFeedbackStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const fb = await Feedback.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!fb) return res.status(404).json({ message: 'Feedback not found' });
    return res.json({ success: true, feedback: fb });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
