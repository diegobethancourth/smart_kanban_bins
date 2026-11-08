# Register map — load-cell simulator (six bins)

Modbus TCP server: port **5020**. Each bin is its own Modbus device with the **same register map**:

| Bin | Unit ID | Item |
|---|---|---|
| bin01 | 1 | 101013101 Folic acid 5 mg |
| bin02 | 2 | 101001101 Paracetamol 500 mg |
| bin03 | 3 | 102013601 Benzathine benzylpenicillin 2.4 MIU |
| bin04 | 4 | 102044501 Diclofenac 25 mg/ml injection |
| bin05 | 5 | 103015801 Hydroxyzine syrup |
| bin06 | 6 | 103016601 Chlorphenamine syrup |

Function code **3** (read holding registers), address 0, quantity 6:

| Address (0-based) | Modbus register | Content | Type |
|---|---|---|---|
| 0 | 40001 | Gross weight on the load cell in **milligrams**, high word | uint32 (part 1) |
| 1 | 40002 | Gross weight in milligrams, low word | uint32 (part 2) |
| 2 | 40003 | Status: 0 = OK, 1 = fault reported by the sensor | uint16 |
| 3 | 40004 | Simulated time in minutes since the first report date, high word | uint32 (part 1) |
| 4 | 40005 | Simulated time, low word | uint32 (part 2) |
| 5 | 40006 | Replay cycle (0 = first run, +1 each time the replay loops) | uint16 |

## Word order

32-bit values are split into two registers, **high word first** (big-endian word order):

    weight_mg = register[0] * 65536 + register[1]
    sim_min   = register[3] * 65536 + register[4]

### Worked example (bin03, benzathine benzylpenicillin)

Tare 600 g, 21.2 g per vial, 120 vials on the scale:

    weight = 600 g + 120 × 21.2 g = 3144 g = 3 144 000 mg
    3 144 000 = 47 × 65536 + 63808   →   registers 40001 = 47, 40002 = 63808

The edge converts back: `units = round((weight_g − tare_g) / unit_g) × scale_k = round(2544 / 21.2) × 1 = 120`.

## Units at the edge

    grams = weight_mg / 1000
    units = round((grams − tare_g) / unit_g) × scale_k

`tare_g`, `unit_g` and `scale_k` come from `config/bins.json`. See `data/README.md` for the scale model.

## Changes since T1.2 (see docs/decisions.md)

- Weight in **milligrams** instead of grams: with tablets of 0.3 g, whole grams could not tell
  one tablet from the next.
- **Gross** weight (including the tare), as a real load cell reports it; the edge subtracts the tare.
- Registers 40004–40006 added so the edge can stamp each event with the simulated time (T3.6).

## Test from the host

modpoll counts registers from 1 and uses `-a` for the unit ID:

    modpoll -m tcp -p 5020 -a 3 -r 1 -c 6 localhost

or, without installing anything, with pymodbus:

    python -c "from pymodbus.client import ModbusTcpClient as C; c=C('localhost',port=5020); c.connect(); print(c.read_holding_registers(0,count=6,device_id=3).registers)"
