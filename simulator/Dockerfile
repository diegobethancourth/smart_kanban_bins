FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py replay.py ./

# bins.json and the series CSV files are mounted by docker-compose.yml
ENV SIM_CONFIG=/config/bins.json \
    SIM_DATA=/data/series

EXPOSE 5020

CMD ["python", "-u", "server.py"]
