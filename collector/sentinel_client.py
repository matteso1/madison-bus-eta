import logging
import json
import time
import grpc
import sys
from pathlib import Path

# Add the current directory to sys.path so generated files can import each other
sys.path.append(str(Path(__file__).parent / 'sentinel_proto'))

import sentinel_pb2
import sentinel_pb2_grpc

logger = logging.getLogger(__name__)

class SentinelClient:
    def __init__(self, host='localhost', port=9092):
        self.target = f"{host}:{port}"
        self.channel = None
        self.stub = None
        self.connect()

    def connect(self):
        """Establish gRPC connection."""
        try:
            # Channel options for TCP proxy compatibility
            options = [
                ('grpc.keepalive_time_ms', 10000),  # 10 sec keepalive
                ('grpc.keepalive_timeout_ms', 5000),  # 5 sec timeout
                ('grpc.keepalive_permit_without_calls', True),
                ('grpc.http2.max_pings_without_data', 0),
                ('grpc.max_receive_message_length', 10 * 1024 * 1024),  # 10MB
                ('grpc.max_send_message_length', 10 * 1024 * 1024),
            ]
            self.channel = grpc.insecure_channel(self.target, options=options)
            self.stub = sentinel_pb2_grpc.SentinelStub(self.channel)
            logger.info(f"Sentinel: Connected to {self.target}")
        except Exception as e:
            logger.error(f"Sentinel: Connection failed: {e}")
            self.channel = None
            self.stub = None

    def produce(self, topic: str, data: dict, partition=0):
        """Produce a JSON message to Sentinel."""
        if not self.stub:
            self.connect()
            if not self.stub:
                return False

        try:
            # Convert dict to bytes
            payload = json.dumps(data).encode('utf-8')
            
            # Create record
            record = sentinel_pb2.Record(
                value=payload,
                timestamp=int(time.time() * 1e9)  # nanoseconds
            )
            
            # Create request
            request = sentinel_pb2.ProduceRequest(
                topic=topic,
                partition=partition,
                records=[record],
                acks=sentinel_pb2.ProduceRequest.LEADER
            )
            
            # Send
            response = self.stub.Produce(request)
            if response.error and response.error.code != 0:
                logger.error(f"Sentinel: Produce error: {response.error.message}")
                return False
                
            return True
            
        except grpc.RpcError as e:
            logger.error(f"Sentinel: RPC failed: {e}")
            # Reset connection on error
            self.channel = None
            self.stub = None
            return False
        except Exception as e:
            logger.error(f"Sentinel: Unexpected error: {e}")
            return False

    def consume(self, topic: str, partition=0, offset=0):
        """Yields records from Sentinel."""
        if not self.stub:
            self.connect()
            if not self.stub:
                return

        try:
            request = sentinel_pb2.ConsumeRequest(
                topic=topic,
                partition=partition,
                offset=offset,
                max_bytes=1024*1024  # 1MB
            )
            
            # This returns a generator
            return self.stub.Consume(request)
            
        except grpc.RpcError as e:
            logger.error(f"Sentinel: Consume RPC failed: {e}")
            return None
        except Exception as e:
            logger.error(f"Sentinel: Consume error: {e}")
            return None

    def close(self):
        if self.channel:
            self.channel.close()
