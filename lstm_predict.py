import sys
import os
import json
import warnings
warnings.filterwarnings('ignore')

# Suppress TensorFlow verbose logging to stderr
os.environ.setdefault('TF_ENABLE_ONEDNN_OPTS', '0')
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '3')
os.environ.setdefault('TF_ENABLE_DEPRECATION_WARNINGS', '0')

import numpy as np
import pandas as pd
import yfinance as yf
from sklearn.preprocessing import MinMaxScaler
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout
import re

POSITIVE_WORDS = {'gain', 'up', 'surge', 'beat', 'positive', 'bull', 'profit', 'strong', 'grow', 'record'}
NEGATIVE_WORDS = {'drop', 'down', 'fall', 'miss', 'weak', 'bear', 'loss', 'concern', 'decline', 'risk'}

def simple_sentiment(text):
    if not text:
        return 'Neutral', 0
    words = re.findall(r"\w+", text.lower())
    score = sum(1 for w in words if w in POSITIVE_WORDS) - sum(1 for w in words if w in NEGATIVE_WORDS)
    if score > 1:
        return 'Positive', score
    if score < -1:
        return 'Negative', score
    return 'Neutral', score

def fetch_stock_data(symbol, period='6mo'):
    """Fetch historical stock data from Yahoo Finance, fallback to mock data on rate limit"""
    try:
        stock = yf.Ticker(symbol)
        df = stock.history(period=period)
        
        if df.empty:
            raise Exception("Empty dataframe returned by yfinance")
        
        # Get current price and metadata
        info = stock.info
        current_price = df['Close'].iloc[-1]
        currency = info.get('currency', 'USD')
        name = info.get('longName') or info.get('shortName') or symbol
        
        return df, current_price, currency, name
    except Exception as e:
        print(f"Warning: Falling back to mock data due to error: {e}", file=sys.stderr)
        # Generate mock data for demonstration
        import datetime
        end_date = datetime.datetime.now()
        start_date = end_date - datetime.timedelta(days=180)
        dates = pd.bdate_range(start=start_date, end=end_date)
        
        np.random.seed(hash(symbol) % (2**32 - 1))  # Stable seed per symbol
        
        # Random walk for prices
        returns = np.random.normal(0, 0.02, len(dates))
        base_price = 100.0 if not symbol.endswith('.NS') else 2500.0
        price_path = base_price * np.exp(np.cumsum(returns))
        
        df = pd.DataFrame(index=dates)
        df.index.name = 'Date'
        df['Close'] = price_path
        df['Open'] = price_path * np.random.normal(1.0, 0.005, len(dates))
        df['High'] = np.maximum(df['Open'], df['Close']) * np.random.normal(1.005, 0.002, len(dates))
        df['Low'] = np.minimum(df['Open'], df['Close']) * np.random.normal(0.995, 0.002, len(dates))
        df['Volume'] = np.random.randint(100000, 5000000, len(dates))
        
        current_price = df['Close'].iloc[-1]
        currency = 'INR' if symbol.endswith('.NS') else 'USD'
        name = symbol.replace('.NS', '') + ' (Mocked)'
        
        return df, current_price, currency, name

def prepare_data(df, lookback=60):
    """Prepare data for LSTM model"""
    data = df['Close'].values.reshape(-1, 1)
    
    # Scale the data
    scaler = MinMaxScaler(feature_range=(0, 1))
    scaled_data = scaler.fit_transform(data)
    
    # Create sequences
    X, y = [], []
    for i in range(lookback, len(scaled_data)):
        X.append(scaled_data[i-lookback:i, 0])
        y.append(scaled_data[i, 0])
    
    X, y = np.array(X), np.array(y)
    X = np.reshape(X, (X.shape[0], X.shape[1], 1))
    
    return X, y, scaler, scaled_data

def create_lstm_model(lookback=60):
    """Create and compile LSTM model"""
    model = Sequential([
        LSTM(units=50, return_sequences=True, input_shape=(lookback, 1)),
        Dropout(0.2),
        LSTM(units=50, return_sequences=True),
        Dropout(0.2),
        LSTM(units=50),
        Dropout(0.2),
        Dense(units=1)
    ])
    
    model.compile(optimizer='adam', loss='mean_squared_error')
    return model

def predict_future(model, last_sequence, scaler, days=20):
    """Predict future stock prices"""
    predictions = []
    current_sequence = last_sequence.copy()
    
    for _ in range(days):
        # Predict next value
        next_pred = model.predict(current_sequence.reshape(1, -1, 1), verbose=0)
        predictions.append(next_pred[0, 0])
        
        # Update sequence
        current_sequence = np.append(current_sequence[1:], next_pred[0, 0])
    
    # Inverse transform predictions
    predictions = scaler.inverse_transform(np.array(predictions).reshape(-1, 1))
    return predictions.flatten()

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No symbol provided"}))
        sys.exit(1)
    
    symbol = sys.argv[1].upper()
    
    # Fetch data
    df, current_price, currency, name = fetch_stock_data(symbol)

    # Try to get news for sentiment (yfinance news may be limited)
    sentiment_summary = 'No recent headlines found.'
    sentiment_score = 0
    sentiment_label = 'Neutral'
    headlines_list = []
    try:
        ticker = yf.Ticker(symbol)
        news_items = ticker.news or []

        def _extract_title(item):
            """Handle both old yfinance (item['title']) and new (item['content']['title'])."""
            content = item.get('content')
            if isinstance(content, dict) and content.get('title'):
                return content['title']
            return item.get('title', '')

        headlines_list = [_extract_title(item) for item in news_items[:15]]
        headlines_list = [h for h in headlines_list if h.strip()]

        combined_text = ' '.join(headlines_list)
        sentiment_label, sentiment_score = simple_sentiment(combined_text)

        if headlines_list:
            sentiment_summary = f"{len(headlines_list)} recent headlines analyzed."
        else:
            sentiment_summary = 'No recent headlines found.'
    except Exception:
        sentiment_summary = 'News sentiment analysis failed.'
    
    if df is None or len(df) < 70:
        print(json.dumps({
            "error": "Insufficient data for prediction",
            "message": "Need at least 70 days of historical data"
        }))
        sys.exit(1)
    
    # Prepare data
    lookback = 60
    X, y, scaler, scaled_data = prepare_data(df, lookback)
    
    if len(X) < 10:
        print(json.dumps({
            "error": "Insufficient training data",
            "message": "Not enough data points for training"
        }))
        sys.exit(1)
    
    # Create and train model
    model = create_lstm_model(lookback)
    
    # Train with minimal epochs for speed (preventing request timeouts on the web end)
    model.fit(X, y, epochs=5, batch_size=32, verbose=0)
    
    # Get last sequence for prediction
    last_sequence = scaled_data[-lookback:]
    
    # Predict future prices
    future_prices = predict_future(model, last_sequence, scaler, days=20)
    
    # Support/resistance detection (recent 30 days)
    support_window = df['Close'].tail(30)
    support_levels = np.percentile(support_window, [5, 20, 35]).tolist()
    resistance_levels = np.percentile(support_window, [65, 80, 95]).tolist()

    # Calculate confidence based on recent volatility
    recent_prices = df['Close'].tail(30).values
    volatility = np.std(recent_prices) / np.mean(recent_prices)
    confidence = max(70, min(98, int((1 - volatility) * 100)))

    # AI explanation text (for display)
    ai_basis = (
        'Combined LSTM forecast with technical support/resistance levels ' 
        'from the last 30 days; uses recent trend and volatility for confidence.'
    )

    # Build history and forecast timeline
    history_data = []
    recent_history = df[['Open', 'High', 'Low', 'Close', 'Volume']].tail(60).reset_index()
    for row in recent_history.itertuples(index=False):
        history_data.append({
            'date': row.Date.strftime('%Y-%m-%d'),
            'open': float(row.Open),
            'high': float(row.High),
            'low': float(row.Low),
            'close': float(row.Close),
            'volume': float(row.Volume)
        })

    forecast_periods = pd.bdate_range(start=df.index[-1] + pd.Timedelta(days=1), periods=len(future_prices))
    forecast_data = []
    for idx, val in enumerate(future_prices):
        forecast_data.append({
            'date': forecast_periods[idx].strftime('%Y-%m-%d'),
            'value': float(val)
        })

    # Prepare output
    result = {
        "symbol": symbol,
        "name": name,
        "currency": currency,
        "currentPrice": float(current_price),
        "predictions": {
            "5": float(future_prices[4]),
            "10": float(future_prices[9]),
            "15": float(future_prices[14]),
            "20": float(future_prices[19])
        },
        "supportResistance": {
            "recentMin": float(support_window.min()),
            "recentMax": float(support_window.max()),
            "supportLevels": [float(x) for x in support_levels],
            "resistanceLevels": [float(x) for x in resistance_levels]
        },
        "confidence": f"{confidence}%",
        "sentiment": {
            "label": sentiment_label,
            "score": sentiment_score,
            "summary": sentiment_summary,
            "headlines": headlines_list
        },
        "basis": {
            "method": "LSTM Neural Network + Support/Resistance Analysis",
            "dataPointsUsed": len(df),
            "trend": "Upward" if future_prices[19] > current_price else "Downward",
            "explanation": ai_basis
        },
        "history": history_data,
        "forecast": forecast_data
    }
    
    print(json.dumps(result))

if __name__ == "__main__":
    main()
