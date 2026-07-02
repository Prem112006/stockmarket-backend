import sys
import json
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.patches import Rectangle
from datetime import datetime
import base64
from io import BytesIO

# Read prediction data from stdin
input_data = sys.stdin.read()
data = json.loads(input_data)

# Create figure and axis
fig, ax = plt.subplots(figsize=(14, 7))

# Parse historical data
history = data.get('history', [])
hist_dates = []
opens, highs, lows, closes = [], [], [], []

for point in history:
    d = datetime.strptime(point['date'][:10], '%Y-%m-%d')
    hist_dates.append(mdates.date2num(d))
    # Support both OHLC format ('close') and simple value format ('value')
    fallback = point.get('close', point.get('value', 0))
    opens.append(point.get('open', fallback))
    highs.append(point.get('high', fallback))
    lows.append(point.get('low', fallback))
    closes.append(fallback)

# Plot candlesticks
width = 0.6
width2 = 0.1

for i in range(len(hist_dates)):
    o, h, l, c = opens[i], highs[i], lows[i], closes[i]
    color = '#2ecc71' if c >= o else '#e74c3c'
    
    # Draw high/low line
    ax.plot([hist_dates[i], hist_dates[i]], [l, h], color=color, linewidth=1.5)
    
    # Draw open/close box
    box_min = min(o, c)
    box_max = max(o, c)
    rect = Rectangle((hist_dates[i] - width/2, box_min), width, box_max - box_min, facecolor=color, edgecolor=color)
    ax.add_patch(rect)

# Add a fake line for legend
ax.plot([], [], color='#2ecc71', label='Historical Price (Candle)')

# Parse forecast data
forecast = data.get('forecast', [])
fore_dates = []
fore_values = []
for point in forecast:
    fore_dates.append(mdates.date2num(datetime.strptime(point['date'], '%Y-%m-%d')))
    fore_values.append(point['value'])

# Plot forecast
model_label = data.get('model', 'LSTM')
ax.plot(fore_dates, fore_values, label=f'{model_label} Forecast', color='#f3b74a', linewidth=2.5, linestyle='--', marker='s', markersize=3)

# Add current price line
current_price = data.get('currentPrice', 0)
ax.axhline(y=current_price, color='#2ecc71', linestyle=':', linewidth=2, label=f'Current Price: {current_price:.2f}')

# Add support/resistance levels
support_levels = data.get('supportResistance', {}).get('supportLevels', [])
for i, level in enumerate(support_levels):
    label = 'Support Levels' if i == 0 else ''
    ax.axhline(y=level, color='#e74c3c', linestyle='--', alpha=0.5, linewidth=1, label=label)

resistance_levels = data.get('supportResistance', {}).get('resistanceLevels', [])
for i, level in enumerate(resistance_levels):
    label = 'Resistance Levels' if i == 0 else ''
    ax.axhline(y=level, color='#3498db', linestyle='--', alpha=0.5, linewidth=1, label=label)

# Formatting
symbol = data.get('symbol', 'STOCK')
name = data.get('name', '')
currency = data.get('currency', 'INR')
confidence = data.get('confidence', '—')
trend = data.get('basis', {}).get('trend', '—')
sentiment = data.get('sentiment', {}).get('label', 'Neutral')

model_display = data.get('model', 'LSTM Neural Network')
title_text = f'{symbol} - {name}\nPrice Prediction with {model_display}'
ax.set_title(title_text, fontsize=16, fontweight='bold', pad=20)

info_text = f'Confidence: {confidence} | Trend: {trend} | Sentiment: {sentiment} | Currency: {currency}'
ax.text(0.02, 0.98, info_text, transform=ax.transAxes, fontsize=10,
        verticalalignment='top', bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))

ax.set_xlabel('Date', fontsize=12, fontweight='bold')
ax.set_ylabel(f'Price ({currency})', fontsize=12, fontweight='bold')
ax.legend(loc='upper left', fontsize=10, framealpha=0.9)
ax.grid(True, alpha=0.3, linestyle=':')

ax.xaxis.set_major_locator(mdates.MonthLocator())
ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d'))
plt.xticks(rotation=45, ha='right')

plt.tight_layout()

buffer = BytesIO()
plt.savefig(buffer, format='png', dpi=100, bbox_inches='tight')
buffer.seek(0)
image_base64 = base64.b64encode(buffer.read()).decode('utf-8')
print(image_base64)
plt.close()

