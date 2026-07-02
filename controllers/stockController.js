const { validationResult } = require('express-validator');
const axios = require('axios');

const Stock = require('../models/Stock');

const normalizeSymbol = (symbol) => String(symbol || '').trim().toUpperCase();

const PRICE_CACHE_TTL_MS = Number(process.env.PRICE_CACHE_TTL_MS || 15000); // 15 seconds for faster updates

const isFresh = (date) => {
  if (!date) return false;
  const ts = new Date(date).getTime();
  return Number.isFinite(ts) && Date.now() - ts < PRICE_CACHE_TTL_MS;
};

exports.getLivePrice = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation error', errors: errors.array() });
    }

    // Yahoo Finance works well with symbols like 'RELIANCE.NS', 'AAPL', etc.
    const symbol = normalizeSymbol(req.params.symbol);

    // Check cache first if not forced
    const force = String(req.query.force || '').toLowerCase() === 'true';
    if (!force) {
      const existing = await Stock.findOne({ symbol });
      if (existing && Number.isFinite(Number(existing.currentPrice)) && isFresh(existing.updatedAt)) {
        return res.json({
          message: 'Live price fetched',
          stock: {
            id: existing._id,
            symbol: existing.symbol,
            name: existing.name,
            currentPrice: existing.currentPrice,
            currency: existing.currency,
            updatedAt: existing.updatedAt
          },
          cached: true
        });
      }
    }

    let quote;
    try {
      // Use Yahoo Finance Chart API v8
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0' // Required by Yahoo
        }
      });

      const result = response.data?.chart?.result?.[0];
      if (!result || !result.meta) {
        throw new Error('No data found');
      }
      quote = result.meta;
    } catch (err) {
      const msg = String(err?.message || err);
      // Fallback to cached stale data if available
      const existing = await Stock.findOne({ symbol });
      if (existing && Number.isFinite(Number(existing.currentPrice))) {
        return res.status(200).json({
          message: 'Live price fetched (stale)',
          stock: {
            id: existing._id,
            symbol: existing.symbol,
            name: existing.name,
            currentPrice: existing.currentPrice,
            currency: existing.currency,
            updatedAt: existing.updatedAt
          },
          cached: true,
          stale: true,
          warning: 'Provider failed or symbol not found. Showing last known price.'
        });
      }
      return res.status(502).json({
        message: 'Failed to fetch live price',
        details: msg
      });
    }

    const price = quote.regularMarketPrice;
    if (!Number.isFinite(price)) {
      return res.status(502).json({ message: 'Invalid price data from provider' });
    }

    // Attempt to get name from meta or fetch additional details
    let name = quote.longName || quote.shortName || symbol;
    const currency = quote.currency || 'USD';

    // If we don't have a proper name (just the symbol), try to get it from the search API
    if (name === symbol) {
      try {
        const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}`;
        const searchResponse = await axios.get(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0'
          }
        });

        const searchResult = searchResponse.data?.quotes?.[0];
        if (searchResult?.longname || searchResult?.shortname) {
          name = searchResult.longname || searchResult.shortname;
        }
      } catch (searchErr) {
        // Ignore search errors and keep the symbol as name
        console.log('Search API failed for', symbol, ':', searchErr.message);
      }
    }

    const stock = await Stock.findOneAndUpdate(
      { symbol },
      { symbol, name, currentPrice: price, currency },
      { upsert: true, new: true }
    );

    return res.json({
      message: 'Live price fetched',
      stock: {
        id: stock._id,
        symbol: stock.symbol,
        name: stock.name,
        currentPrice: stock.currentPrice,
        currency: stock.currency,
        updatedAt: stock.updatedAt
      }
    });
  } catch (err) {
    return next(err);
  }
};

exports.getMultiplePrices = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation error', errors: errors.array() });
    }

    const symbols = req.body.symbols || [];
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ message: 'Symbols array is required' });
    }

    const force = String(req.query.force || '').toLowerCase() === 'true';

    // Process symbols in parallel batches for better performance
    const batchSize = 25; // Reduced batch size for faster response
    const results = [];

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);

      const batchPromises = batch.map(async (symbol) => {
        const normalizedSymbol = normalizeSymbol(symbol);

        try {
          // Check cache first if not forced
          if (!force) {
            const existing = await Stock.findOne({ symbol: normalizedSymbol });
            if (existing && Number.isFinite(Number(existing.currentPrice)) && isFresh(existing.updatedAt)) {
              return {
                symbol: normalizedSymbol,
                name: existing.name,
                currentPrice: existing.currentPrice,
                currency: existing.currency,
                updatedAt: existing.updatedAt,
                cached: true
              };
            }
          }

          // Fetch from Yahoo Finance
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${normalizedSymbol}`;
          const response = await axios.get(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0'
            },
            timeout: 2000 // 2 second timeout per request for faster processing
          });

          const result = response.data?.chart?.result?.[0];
          if (!result || !result.meta) {
            // Fallback to cached stale data if available
            const existing = await Stock.findOne({ symbol: normalizedSymbol });
            if (existing && Number.isFinite(Number(existing.currentPrice))) {
              return {
                symbol: normalizedSymbol,
                name: existing.name,
                currentPrice: existing.currentPrice,
                currency: existing.currency,
                updatedAt: existing.updatedAt,
                cached: true,
                stale: true,
                warning: 'Provider failed or symbol not found. Showing last known price.'
              };
            }
            return {
              symbol: normalizedSymbol,
              error: 'No data found'
            };
          }

          const quote = result.meta;
          const price = quote.regularMarketPrice;

          if (!Number.isFinite(price)) {
            return {
              symbol: normalizedSymbol,
              error: 'Invalid price data'
            };
          }

          const name = quote.longName || quote.shortName || normalizedSymbol;
          const currency = quote.currency || 'USD';

          const stock = await Stock.findOneAndUpdate(
            { symbol: normalizedSymbol },
            { symbol: normalizedSymbol, name, currentPrice: price, currency },
            { upsert: true, new: true }
          );

          return {
            symbol: normalizedSymbol,
            name: stock.name,
            currentPrice: stock.currentPrice,
            previousClose: quote.previousClose || quote.chartPreviousClose || price,
            currency: stock.currency,
            updatedAt: stock.updatedAt,
            cached: false
          };

        } catch (err) {
          // Fallback to cached stale data if available
          try {
            const existing = await Stock.findOne({ symbol: normalizedSymbol });
            if (existing && Number.isFinite(Number(existing.currentPrice))) {
              return {
                symbol: normalizedSymbol,
                name: existing.name,
                currentPrice: existing.currentPrice,
                currency: existing.currency,
                updatedAt: existing.updatedAt,
                cached: true,
                stale: true,
                warning: 'Provider failed. Showing last known price.'
              };
            }
          } catch (dbErr) {
            // Ignore database errors
          }

          return {
            symbol: normalizedSymbol,
            error: String(err?.message || err) || 'Failed to fetch price'
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return res.json({
      message: 'Multiple prices fetched',
      results
    });
  } catch (err) {
    return next(err);
  }
};

exports.listStocks = async (req, res, next) => {
  try {
    const stocks = await Stock.find().sort({ updatedAt: -1 }).limit(50);

    return res.json({
      message: 'Stocks fetched',
      stocks: stocks.map((s) => ({
        id: s._id,
        symbol: s.symbol,
        name: s.name,
        currentPrice: s.currentPrice,
        currency: s.currency,
        updatedAt: s.updatedAt
      }))
    });
  } catch (err) {
    return next(err);
  }
};

exports.getChartData = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation error', errors: errors.array() });
    }

    const symbol = normalizeSymbol(req.params.symbol);
    const range = req.query.range || '1d'; // 1d, 5d, 1mo, 3mo, 6mo, 1y, 5y
    const interval = req.query.interval || '5m'; // 1m, 5m, 15m, 30m, 1h, 1d, 1wk, 1mo

    try {
      // Fetch historical data from Yahoo Finance
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 5000
      });

      const result = response.data?.chart?.result?.[0];
      if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
        return res.status(502).json({ message: 'No chart data found' });
      }

      const timestamps = result.timestamp;
      const quote = result.indicators.quote[0];
      const { open, high, low, close, volume } = quote;

      // Format data for candlestick chart
      const candlestickData = timestamps.map((timestamp, index) => ({
        time: timestamp,
        open: open[index],
        high: high[index],
        low: low[index],
        close: close[index],
        volume: volume[index]
      })).filter(candle =>
        candle.open !== null &&
        candle.high !== null &&
        candle.low !== null &&
        candle.close !== null
      );

      const meta = result.meta;

      return res.json({
        message: 'Chart data fetched',
        symbol: symbol,
        name: meta.longName || meta.shortName || symbol,
        currency: meta.currency || 'USD',
        data: candlestickData,
        meta: {
          range,
          interval,
          regularMarketPrice: meta.regularMarketPrice,
          previousClose: meta.previousClose,
          chartPreviousClose: meta.chartPreviousClose,
          regularMarketDayHigh: meta.regularMarketDayHigh,
          regularMarketDayLow: meta.regularMarketDayLow
        }
      });
    } catch (err) {
      const msg = String(err?.message || err);
      return res.status(502).json({
        message: 'Failed to fetch chart data',
        details: msg
      });
    }
  } catch (err) {
    return next(err);
  }
};

