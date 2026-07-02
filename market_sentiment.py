# market_sentiment.py
# Analyzes global and national market sentiment based on news
# and provides historical data for an "Entire Market" graph (e.g. NIFTY 50)

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
    'upgrade', 'expansion', 'revenue', 'earnings', 'dividend', 'high', 'peak'
}
NEGATIVE_WORDS = {
    'drop', 'down', 'fall', 'miss', 'weak', 'bear', 'loss', 'concern',
    'decline', 'risk', 'sell', 'downgrade', 'debt', 'layoff', 'crash',
    'recession', 'volatile', 'uncertainty', 'investigation', 'lawsuit', 'low'
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
    Try to use the FinBERT model via transformers.
    Falls back to keyword analysis if unavailable.
    """
    if not headlines_list:
        return 'Neutral', 0.0, 'keyword', {'positive': 0, 'neutral': 100, 'negative': 0}

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
        counts = {'positive': 0, 'neutral': 0, 'negative': 0}
        for h in headlines_list[:25]:  # Analyze up to 25 headlines
            if not h.get('title', '').strip():
                continue
            out = pipe(h['title'][:512])[0]
            lbl = out['label'].lower()
            counts[lbl] += 1
            scores.append(label_map.get(lbl, 0) * out['score'])

        if not scores:
            return 'Neutral', 0.0, 'finbert', {'positive': 0, 'neutral': 100, 'negative': 0}

        total = sum(counts.values())
        breakdown = {
            'positive': int((counts['positive'] / total) * 100),
            'neutral': int((counts['neutral'] / total) * 100),
            'negative': int((counts['negative'] / total) * 100)
        }
        # ensure perfectly sums to 100
        rem = 100 - sum(breakdown.values())
        if rem != 0:
            breakdown['neutral'] += rem

        avg = float(np.mean(scores))
        if avg > 0.1:
            label = 'Positive'
        elif avg < -0.1:
            label = 'Negative'
        else:
            label = 'Neutral'
        return label, round(avg, 3), 'finbert', breakdown

    except Exception:
        # Fallback to keywords iteratively to get breakdown
        counts = {'positive': 0, 'neutral': 0, 'negative': 0}
        for h in headlines_list[:25]:
            lbl, sc = keyword_sentiment(h.get('title', ''))
            counts[lbl.lower()] += 1
            
        total = sum(counts.values())
        if total == 0:
             return 'Neutral', 0.0, 'keyword', {'positive': 0, 'neutral': 100, 'negative': 0}
             
        breakdown = {
            'positive': int((counts['positive'] / total) * 100),
            'neutral': int((counts['neutral'] / total) * 100),
            'negative': int((counts['negative'] / total) * 100)
        }
        rem = 100 - sum(breakdown.values())
        if rem != 0:
            breakdown['neutral'] += rem
            
        combined = ' '.join(h.get('title', '') for h in headlines_list)
        lbl, sc = keyword_sentiment(combined)
        return lbl, sc, 'keyword', breakdown


def fetch_market_news():
    """Fetch news from Global (SPY) and National (^NSEI) proxies."""
    global_news = []
    national_news = []
    
    try:
        import yfinance as yf
        # Fetch Global News
        spy = yf.Ticker('SPY')
        if spy.news:
            global_news = spy.news
            
        # Fetch National News
        nifty = yf.Ticker('^NSEI')
        if nifty.news:
            national_news = nifty.news
            
    except Exception as e:
        print(f"Warning: yfinance failed to fetch news ({e})", file=sys.stderr)
        
    def extract_info(item, category):
        content = item.get('content', {})
        title = content.get('title') if isinstance(content, dict) else item.get('title', '')
        link = content.get('canonicalUrl') if isinstance(content, dict) else item.get('link', '')
        publisher = content.get('provider', {}).get('displayName') if isinstance(content, dict) else item.get('publisher', 'News')
        
        return {
            'title': title,
            'link': link,
            'publisher': publisher,
            'category': category
        }
        
    formatted_global = [extract_info(n, 'Global') for n in global_news]
    formatted_national = [extract_info(n, 'National') for n in national_news]
    
    # Interleave and merge up to 25 news items
    combined_news = []
    max_len = max(len(formatted_global), len(formatted_national))
    for i in range(max_len):
        if i < len(formatted_national): combined_news.append(formatted_national[i])
        if i < len(formatted_global): combined_news.append(formatted_global[i])
        if len(combined_news) >= 25:
            break
            
    # Mock data if yfinance fails
    if not combined_news:
        combined_news = [
            {'title': 'Global markets rally amid positive economic data', 'link': '#', 'publisher': 'Financial Times', 'category': 'Global'},
            {'title': 'Nifty 50 hits record high as IT stocks surge', 'link': '#', 'publisher': 'Economics Times', 'category': 'National'},
            {'title': 'Investor confidence grows as inflation concerns ease', 'link': '#', 'publisher': 'Reuters', 'category': 'Global'},
            {'title': 'RBI holds interest rates steady, boosting market sentiment', 'link': '#', 'publisher': 'Moneycontrol', 'category': 'National'},
            {'title': 'Tech stocks lead the broader market recovery', 'link': '#', 'publisher': 'Bloomberg', 'category': 'Global'},
            {'title': 'FII inflows continue in Indian equity markets', 'link': '#', 'publisher': 'Mint', 'category': 'National'}
        ]
        
    return combined_news[:25]


def fetch_entire_market_data(period='6mo'):
    """Fetch `^NSEI` (Nifty 50) as proxy for the entire market graph."""
    symbol = '^NSEI'
    try:
        import yfinance as yf
        stock = yf.Ticker(symbol)
        df = stock.history(period=period)
        if df.empty:
            raise Exception('Empty dataframe')
        current_price = float(df['Close'].iloc[-1])
        return df, current_price
    except Exception as e:
        print(f"Warning: yfinance failed to fetch market history ({e}), using mock data", file=sys.stderr)
        import datetime
        end_date = datetime.datetime.now()
        start_date = end_date - datetime.timedelta(days=180)
        dates = pd.bdate_range(start=start_date, end=end_date)
        rng = np.random.default_rng(42)
        returns = rng.normal(0, 0.005, len(dates)) # Less volatile than single stocks
        base = 22000.0  # Nifty 50 range approx
        closes = base * np.exp(np.cumsum(returns))
        opens = closes * rng.normal(1.0, 0.002, len(dates))
        highs = np.maximum(opens, closes) * rng.normal(1.002, 0.001, len(dates))
        lows  = np.minimum(opens, closes) * rng.normal(0.998, 0.001, len(dates))
        df = pd.DataFrame({'Open': opens, 'High': highs, 'Low': lows, 'Close': closes,
                           'Volume': rng.integers(10000000, 50000000, len(dates))}, index=dates)
        df.index.name = 'Date'
        current_price = float(closes[-1])
        return df, current_price


def forecast_prices(df, sentiment_score, days=20):
    """
    Lightweight price forecast for the market:
      1. Fit a linear trend on last 60 close prices.
      2. Extrapolate `days` steps ahead.
      3. Apply a sentiment multiplier to nudge the trajectory.
    """
    closes = df['Close'].tail(60).values.astype(float)
    x = np.arange(len(closes))
    
    # Needs at least 2 points to polyfit
    if len(closes) < 2:
        return [float(closes[-1])] * days
        
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


def get_market_sentiment():
    try:
        combined_news = fetch_market_news()
        sentiment_label, sentiment_score, sentiment_method, breakdown = finbert_sentiment(combined_news)
        
        n_headlines = len(combined_news)
        sentiment_summary = (
            f'{n_headlines} recent global and national headlines analysed using '
            f'{"FinBERT (ProsusAI/finbert)" if sentiment_method == "finbert" else "keyword-based NLP"}.'
        )
        
        # Fetch market trajectory for the graph
        df, current_price = fetch_entire_market_data('3mo') # 3 months chart for dashboard
        
        history_data = []
        recent_history = df[['Open', 'High', 'Low', 'Close', 'Volume']].reset_index()
        for row in recent_history.itertuples(index=False):
            history_data.append({
                'date':   str(row.Date)[:10],   # YYYY-MM-DD
                'open':   float(row.Open),
                'high':   float(row.High),
                'low':    float(row.Low),
                'close':  float(row.Close),
                'volume': float(row.Volume)
            })
            
        # Add N-days forecast
        future_prices = forecast_prices(df, sentiment_score, days=20)
        last_date = pd.Timestamp(df.index[-1])
        forecast_dates = pd.bdate_range(start=last_date + pd.Timedelta(days=1), periods=20)
        forecast_data = [
            {'date': forecast_dates[i].strftime('%Y-%m-%d'), 'value': float(future_prices[i])}
            for i in range(20)
        ]
            
        result = {
            'sentiment': {
                'label':   sentiment_label,
                'score':   sentiment_score,
                'summary': sentiment_summary,
                'breakdown': breakdown
            },
            'news': combined_news,
            'marketGraph': {
                'symbol': '^NSEI (NIFTY 50 Equivalent)',
                'currentPrice': current_price,
                'history': history_data,
                'forecast': forecast_data
            }
        }
        return result
    except Exception as e:
        return {'error': str(e), 'message': 'Internal Server Error'}

if __name__ == '__main__':
    import os
    import math

    old_stdout = sys.stdout
    sys.stdout = open(os.devnull, 'w')
    
    try:
        result = get_market_sentiment()
    finally:
        sys.stdout = old_stdout

    def clean_nan(obj):
        if isinstance(obj, float) and math.isnan(obj):
            return None
        elif isinstance(obj, dict):
            return {k: clean_nan(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [clean_nan(v) for v in obj]
        return obj

    print(json.dumps(clean_nan(result)))
