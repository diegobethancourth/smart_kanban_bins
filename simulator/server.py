"""Smart Kanban Bins - load-cell simulator for one bin (T1.2).

Modbus TCP server on 0.0.0.0:5020, device (unit) ID 1, holding registers:
  address 0-1 (40001-40002): net weight in grams, unsigned 32-bit, high word first
  address 2   (40003):       status, 0 = OK, 1 = fault
Every second a small random dispense is subtracted from the weight.

Written for pymodbus 3.16.1 (SimData / SimDevice API).
"""

import asyncio
import random

from pymodbus.server import StartAsyncTcpServer
from pymodbus.simulator import DataType, SimData, SimDevice

HOST = "0.0.0.0"
PORT = 5020
DEVICE_ID = 1

# bin01 (Folic acid 5 mg) from config/bins.json
UNIT_G = 0.3          # grams per tablet
MAX_STOCK = 6144      # tablets when the bin is full
FULL_GRAMS = int(MAX_STOCK * UNIT_G)

# Current state of the bin; the loop below changes it every second
state = {"grams": FULL_GRAMS, "status": 0}


async def on_request(function_code, start_address, address, count,
                     current_registers, set_values):
    """Called on every Modbus request: copy the current state into the registers."""
    grams = state["grams"]
    current_registers[0] = (grams >> 16) & 0xFFFF   # 40001 high word
    current_registers[1] = grams & 0xFFFF           # 40002 low word
    current_registers[2] = state["status"]          # 40003 status
    return None


async def dispense_loop():
    """Every second, take out a few tablets; refill when the bin is empty."""
    while True:
        print(f"weight = {state['grams']} g, status = {state['status']}")
        await asyncio.sleep(1)
        dispensed_units = random.randint(0, 20)
        state["grams"] -= int(dispensed_units * UNIT_G)
        if state["grams"] <= 0:
            state["grams"] = FULL_GRAMS  # simple refill so the demo keeps running


async def main():
    device = SimDevice(
        id=DEVICE_ID,
        # registers 0, 1, 2 (= holding registers 40001, 40002, 40003)
        simdata=[SimData(address=0, count=3, values=0,
                         datatype=DataType.REGISTERS)],
        action=on_request,
    )
    asyncio.create_task(dispense_loop())
    print(f"Modbus TCP simulator listening on {HOST}:{PORT}")
    await StartAsyncTcpServer(context=device, address=(HOST, PORT))


if __name__ == "__main__":
    asyncio.run(main())
