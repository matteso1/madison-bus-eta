from decimal import Decimal
import json

val_float = 10.5
val_decimal = Decimal('2.0')

res = val_float / val_decimal
print(f"Type of result: {type(res)}")
print(f"Value: {res}")

try:
    json.dumps({"test": res})
except TypeError as e:
    print(f"JSON Dump Failed: {e}")
