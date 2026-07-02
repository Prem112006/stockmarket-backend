const { validationResult } = require('express-validator');
const mongoose = require('mongoose');

const User = require('../models/User');
const Stock = require('../models/Stock');
const Holding = require('../models/Holding');
const Transaction = require('../models/Transaction');

const normalizeSymbol = (symbol) => String(symbol || '').trim().toUpperCase();

const getOrCreateStockBySymbol = async (symbol) => {
  const s = normalizeSymbol(symbol);
  const stock = await Stock.findOne({ symbol: s });
  if (stock) return stock;
  return Stock.create({ symbol: s, name: '', currentPrice: 0 });
};

exports.buyStock = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation error', errors: errors.array() });
    }

    const userId = req.user.id;
    const { symbol, quantity, price } = req.body;

    const qty = Number(quantity);
    const px = Number(price);

    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(px) || px <= 0) {
      return res.status(400).json({ message: 'Invalid quantity or price' });
    }

    const stock = await getOrCreateStockBySymbol(symbol);

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const cost = qty * px;
    if (user.balance < cost) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    user.balance -= cost;
    await user.save();

    const holding = await Holding.findOne({ userId, stockId: stock._id });
    if (holding) {
      holding.quantity += qty;
      await holding.save();
    } else {
      await Holding.create({ userId, stockId: stock._id, quantity: qty });
    }

    const tx = await Transaction.create({
      userId, 
      stockId: stock._id, 
      type: 'BUY', 
      quantity: qty, 
      price: px
    });

    return res.status(201).json({
      message: 'Stock bought successfully',
      transaction: {
        id: tx._id,
        type: tx.type,
        quantity: tx.quantity,
        price: tx.price,
        date: tx.date
      },
      balance: user.balance
    });
  } catch (err) {
    return next(err);
  }
};

exports.sellStock = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation error', errors: errors.array() });
    }

    const userId = req.user.id;
    const { symbol, quantity, price } = req.body;

    const qty = Number(quantity);
    const px = Number(price);

    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(px) || px <= 0) {
      return res.status(400).json({ message: 'Invalid quantity or price' });
    }

    const stock = await getOrCreateStockBySymbol(symbol);

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const holding = await Holding.findOne({ userId, stockId: stock._id });
    if (!holding || holding.quantity < qty) {
      return res.status(400).json({ message: 'Insufficient holdings' });
    }

    holding.quantity -= qty;
    if (holding.quantity === 0) {
      await Holding.deleteOne({ _id: holding._id });
    } else {
      await holding.save();
    }

    const proceeds = qty * px;
    user.balance += proceeds;
    await user.save();

    const tx = await Transaction.create({
      userId, 
      stockId: stock._id, 
      type: 'SELL', 
      quantity: qty, 
      price: px
    });

    return res.status(201).json({
      message: 'Stock sold successfully',
      transaction: {
        id: tx._id,
        type: tx.type,
        quantity: tx.quantity,
        price: tx.price,
        date: tx.date
      },
      balance: user.balance
    });
  } catch (err) {
    return next(err);
  }
};

exports.getPortfolio = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const holdings = await Holding.find({ userId }).populate('stockId');

    return res.json({
      message: 'Portfolio fetched',
      balance: user.balance,
      holdings: holdings.map((h) => ({
        id: h._id,
        stock: {
          id: h.stockId?._id,
          symbol: h.stockId?.symbol,
          name: h.stockId?.name,
          currentPrice: h.stockId?.currentPrice
        },
        quantity: h.quantity
      }))
    });
  } catch (err) {
    return next(err);
  }
};

exports.getTransactions = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const txs = await Transaction.find({ userId })
      .populate('stockId')
      .sort({ date: -1 })
      .limit(100);

    return res.json({
      message: 'Transactions fetched',
      transactions: txs.map((t) => ({
        id: t._id,
        type: t.type,
        quantity: t.quantity,
        price: t.price,
        date: t.date,
        stock: {
          id: t.stockId?._id,
          symbol: t.stockId?.symbol,
          name: t.stockId?.name
        }
      }))
    });
  } catch (err) {
    return next(err);
  }
};
