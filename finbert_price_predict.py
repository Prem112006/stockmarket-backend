# finbert_price_predict.py
# FinBERT + Price Hybrid Model
# Uses real stock data from yfinance + NLP-based sentiment analysis
# Output format matches lstm_predict.py for seamless frontend integration

import sys
import json
import warnings
warnings.filterwarnings('ignore')

import numpy as np
import pandas as pd
import re

# ------------------------------------------------------------------ #
#  Sentiment helpers (keyword fallback used when transformers absent) #
# ------------------------------------------------------------------ #
POSITIVE_WORDS = {
    'gain', 'up', 'surge', 'beat', 'positive', 'bull', 'profit', 'strong',
    'grow', 'record', 'rally', 'rise', 'boost', 'jump', 'outperform', 'buy',
    'upgrade', 'expansion', 'revenue', 'earnings', 'dividend'
}
NEGATIVE_WORDS = {
    'drop', 'down', 'fall', 'miss', 'weak', 'bear', 'loss', 'concern',
    'decline', 'risk', 'sell', 'downgrade', 'debt', 'layoff', 'crash',
    'recession', 'volatile', 'uncertainty', 'investigation', 'lawsuit'
}


def keyword_sentiment(text):
    """Simple keyword-based sentiment analysis (fallback)."""
    if not text:
        return 'Neutral', 0.0
    words = re.findall(r'\w+', text.lower())
    pos = sum(1 for w in words if w in POSITIVE_WORDS)
    neg = sum(1 for w in words if w in NEGATIVE_WORDS)
    score = pos - neg
    if score > 1:
        return 'Positive', round(min(score / 5.0, 1.0), 3)
    if score < -1:
        return 'Negative', round(max(score / 5.0, -1.0), 3)
    return 'Neutral', 0.0


def finbert_sentiment(headlines_list):
    """
    Try to use the FinBERT model (ProsusAI/finbert) via transformers.
    Falls back to keyword analysis if the library / model is unavailable.
    Returns (label: str, compound_score: float, method: str)
    """
    if not headlines_list:
        return 'Neutral', 0.0, 'keyword'

    # --- attempt transformers FinBERT ---
    try:
        from transformers import pipeline
        pipe = pipeline(
            'text-classification',
            model='ProsusAI/finbert',
            truncation=True,
            max_length=512
        )
        label_map = {'positive': 1, 'negative': -1, 'neutral': 0}
        scores = []
        for h in headlines_list[:10]:
            if not h.strip():
                continue
            out = pipe(h[:512])[0]
            lbl = out['label'].lower()
            scores.append(label_map.get(lbl, 0) * out['score'])

        if not scores:
            return 'Neutral', 0.0, 'finbert'

        avg = float(np.mean(scores))
        if avg > 0.1:
            label = 'Positive'
        elif avg < -0.1:
            label = 'Negative'
        else:
            label = 'Neutral'
        return label, round(avg, 3), 'finbert'

    except Exception:
        # transformers not installed or model unavailable — use keywords
        combined = ' '.join(headlines_list)
        lbl, sc = keyword_sentiment(combined)
        return lbl, sc, 'keyword'


# ------------------------------------------------------------------ #
#  Stock data                                                          #
# ------------------------------------------------------------------ #
def fetch_stock_data(symbol, period='6mo'):
    """Fetch historical data from Yahoo Finance with a mock fallback."""
    try:
        import yfinance as yf
        stock = yf.Ticker(symbol)
        df = stock.history(period=period)
        if df.empty:
            raise Exception('Empty dataframe')
        info = stock.info
        current_price = float(df['Close'].iloc[-1])
        currency = info.get('currency', 'INR')
        name = info.get('longName') or info.get('shortName') or symbol
        news_items = []
        try:
            news_items = stock.news or []
        except Exception:
            pass
        return df, current_price, currency, name, news_items
    except Exception as e:
        print(f'Warning: yfinance failed ({e}), using mock data', file=sys.stderr)
        import datetime
        end_date = datetime.datetime.now()
        start_date = end_date - datetime.timedelta(days=180)
        dates = pd.bdate_range(start=start_date, end=end_date)
        rng = np.random.default_rng(abs(hash(symbol)) % (2**32))
        returns = rng.normal(0, 0.015, len(dates))
        base = 2500.0 if symbol.endswith('.NS') else 150.0
        closes = base * np.exp(np.cumsum(returns))
        opens = closes * rng.normal(1.0, 0.004, len(dates))
        highs = np.maximum(opens, closes) * rng.normal(1.004, 0.002, len(dates))
        lows  = np.minimum(opens, closes) * rng.normal(0.996, 0.002, len(dates))
        df = pd.DataFrame({'Open': opens, 'High': highs, 'Low': lows, 'Close': closes,
                           'Volume': rng.integers(100000, 5000000, len(dates))}, index=dates)
        df.index.name = 'Date'
        current_price = float(closes[-1])
        currency = 'INR' if symbol.endswith('.NS') else 'USD'
        name = symbol.replace('.NS', '') + ' (Estimated)'
        return df, current_price, currency, name, []


# ------------------------------------------------------------------ #
#  Price forecasting (linear regression + sentiment adjustment)        #
# ------------------------------------------------------------------ #
def forecast_prices(df, sentiment_score, days=20):
    """
    Lightweight price forecast:
      1. Fit a linear trend on last 60 close prices.
      2. Extrapolate `days` steps ahead.
      3. Apply a sentiment multiplier to nudge the trajectory.
    Returns array of `days` predicted prices.
    """
    closes = df['Close'].tail(60).values.astype(float)
    x = np.arange(len(closes))
    # Linear regression
    coeffs = np.polyfit(x, closes, 1)
    slope, intercept = coeffs

    future_x = np.arange(len(closes), len(closes) + days)
    base_forecast = slope * future_x + intercept

    # Sentiment adjustment: ±0.5 % per day at extreme sentiment
    sentiment_daily_delta = sentiment_score * 0.005
    adjustments = np.array([base_forecast[i] * (1 + sentiment_daily_delta * (i + 1))
                             for i in range(days)])

    # Add mild mean-reversion noise for realism
    rng = np.random.default_rng(42)
    noise = rng.normal(0, np.std(closes) * 0.01, days)
    return adjustments + noise


# ------------------------------------------------------------------ #
#  Main                                                                #
# ------------------------------------------------------------------ #
def predict(symbol, period='6mo'):
    df, current_price, currency, name, news_items = fetch_stock_data(symbol, period)

    # ---- Sentiment ----
    def _extract_title(item):
        """Handle both old yfinance (item['title']) and new (item['content']['title'])."""
        # New yfinance schema: {'id': ..., 'content': {'title': ..., ...}}
        content = item.get('content')
        if isinstance(content, dict) and content.get('title'):
            return content['title']
        # Legacy yfinance schema: {'title': ..., ...}
        return item.get('title', '')

    headlines = [_extract_title(item) for item in news_items[:15]]
    headlines = [h for h in headlines if h.strip()]
    sentiment_label, sentiment_score, sentiment_method = finbert_sentiment(headlines)
    n_headlines = len(headlines)
    if n_headlines:
        sentiment_summary = (
            f'{n_headlines} recent headlines analysed using '
            f'{"FinBERT (ProsusAI/finbert)" if sentiment_method == "finbert" else "keyword-based NLP"}.'
        )
    else:
        sentiment_summary = 'No recent news headlines found for this symbol.'

    # ---- Forecast ----
    future_prices = forecast_prices(df, sentiment_score, days=20)

    # ---- Support / Resistance (last 30 days) ----
    window = df['Close'].tail(30)
    support_levels = np.percentile(window, [10, 25]).tolist()
    resistance_levels = np.percentile(window, [75, 90]).tolist()

    # ---- Confidence (based on volatility + sentiment conviction) ----
    recent = df['Close'].tail(30).values.astype(float)
    volatility = np.std(recent) / np.mean(recent)
    base_conf = max(65, min(95, int((1 - volatility) * 100)))
    # Sentiment conviction bonus/penalty
    conviction_bonus = int(abs(sentiment_score) * 5)
    confidence = min(98, base_conf + conviction_bonus)

    trend = 'Upward' if future_prices[-1] > current_price else 'Downward'

    # ---- History data (last 60 candles, matching lstm_predict.py schema) ----
    history_data = []
    recent_history = df[['Open', 'High', 'Low', 'Close', 'Volume']].tail(60).reset_index()
    for row in recent_history.itertuples(index=False):
        history_data.append({
            'date':   str(row.Date)[:10],   # YYYY-MM-DD
            'open':   float(row.Open),
            'high':   float(row.High),
            'low':    float(row.Low),
            'close':  float(row.Close),
            'volume': float(row.Volume)
        })

    # ---- Forecast data ----
    last_date = pd.Timestamp(df.index[-1])
    forecast_dates = pd.bdate_range(start=last_date + pd.Timedelta(days=1), periods=20)
    forecast_data = [
        {'date': forecast_dates[i].strftime('%Y-%m-%d'), 'value': float(future_prices[i])}
        for i in range(20)
    ]

    return {
        'symbol':   symbol,
        'name':     name,
        'currency': currency,
        'currentPrice': current_price,
        'predictions': {
            '5':  round(float(future_prices[4]),  2),
            '10': round(float(future_prices[9]),  2),
            '15': round(float(future_prices[14]), 2),
            '20': round(float(future_prices[19]), 2),
        },
        'supportResistance': {
            'supportLevels':    [round(float(x), 2) for x in support_levels],
            'resistanceLevels': [round(float(x), 2) for x in resistance_levels],
        },
        'confidence': f'{confidence}%',   # string like "87%" — matches LSTM format
        'model': 'FinBERT+Price',
        'sentiment': {
            'label':   sentiment_label,
            'score':   sentiment_score,
            'summary': sentiment_summary,
            'headlines': headlines,   # list of raw headline strings
        },
        'basis': {
            'method': 'FinBERT Sentiment + Linear Price Trend',
            'dataPointsUsed': len(df),
            'trend': trend,
            'explanation': (
                f'Linear price trend extrapolated from last 60 trading days, '
                f'adjusted by {sentiment_label.lower()} market sentiment '
                f'(score: {sentiment_score:+.3f}). '
                f'Confidence reflects volatility and sentiment conviction.'
            ),
        },
        # Keys MUST match lstm_predict.py ("history" / "forecast") so that
        # the frontend JS and generate_chart.py work without modification.
        'history':  history_data,
        'forecast': forecast_data,
    }


if __name__ == '__main__':
    symbol = sys.argv[1] if len(sys.argv) > 1 else 'RELIANCE.NS'
    result = predict(symbol)
    print(json.dumps(result))
