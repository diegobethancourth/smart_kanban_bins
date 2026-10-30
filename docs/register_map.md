# Register map — load-cell simulator (one bin)

Modbus TCP server: port **5020**, device (unit) ID **1**, function code **3** (read holding registers).

| Address (0-based) | Modbus register | Content | Type |
|---|---|---|---|
| 0 | 40001 | Net weight, high word | part of uint32 |
| 1 | 40002 | Net weight, low word | part of uint32 |
| 2 | 40003 | Status: 0 = OK, 1 = fault | uint16 |

## Word order

The net weight in grams is an unsigned 32-bit value split into two registers, **high word first** (big-endian word order):

    grams = register[0] * 65536 + register[1]

Example: registers `[0, 1358, 0]` → 1358 g, status OK.

## Notes

- The simulator starts with bin01 (folic acid 5 mg) full: 6144 tablets × 0.3 g = 1843 g.
- Every second it removes 0–20 tablets at random; when empty it refills.
- Port 5020 is used instead of 502 so no administrator rights are needed.
- modpoll counts registers from 1: `modpoll -m tcp -p 5020 -r 1 -c 3 localhost`
