import redis
import json
import os

# Connect to Redis (localhost by default)
redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
redis_client = redis.from_url(redis_url, decode_responses=True)

class StateManager:
    @staticmethod
    def get_float(key, default=None):
        val = redis_client.get(key)
        return float(val) if val is not None else default

    @staticmethod
    def get_int(key, default=None):
        val = redis_client.get(key)
        return int(val) if val is not None else default

    @staticmethod
    def get_str(key, default=None):
        val = redis_client.get(key)
        return val if val is not None else default

    @staticmethod
    def set(key, value):
        redis_client.set(key, value)
        
    @staticmethod
    def delete(key):
        redis_client.delete(key)
