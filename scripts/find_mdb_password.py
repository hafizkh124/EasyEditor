import os
import sys

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

def find_password(filepath):
    if not os.path.exists(filepath):
        return
    with open(filepath, "rb") as f:
        data = f.read(0x100)
        
    pwd_bytes = data[0x42:0x62]
    print(f"--- File: {os.path.basename(filepath)} ---")
    print("Raw pwd bytes hex:", pwd_bytes.hex())
    
    # Jet 3 XOR mask (Access 97)
    jet3_mask = bytes([
        0x86, 0xfb, 0xec, 0x37, 0x5d, 0x44, 0x9c, 0xfa,
        0xc6, 0x5e, 0x28, 0xe6, 0x13, 0xb6, 0x8a, 0x60,
        0x54, 0x94
    ])
    
    j3_decoded = bytes([pwd_bytes[i] ^ jet3_mask[i] for i in range(min(len(pwd_bytes), len(jet3_mask)))])
    print("Jet3 Decoded (repr):", repr(j3_decoded.split(b'\x00')[0]))
    
    # Jet 4 XOR mask (Access 2000/2003)
    jet4_mask = bytes([
        0xbe, 0xec, 0x65, 0x9c, 0xfe, 0x28, 0x2c, 0x8a,
        0xec, 0xa4, 0xbf, 0xcb, 0x5a, 0x76, 0x1d, 0x1f,
        0x29, 0xb6, 0x24, 0xf6, 0xc1, 0x1d, 0x67, 0xd0,
        0xe0, 0x1c, 0x06, 0x47, 0x3f, 0x33, 0xbb, 0xfe
    ])
    
    j4_raw = bytes([pwd_bytes[i] ^ jet4_mask[i] for i in range(min(len(pwd_bytes), len(jet4_mask)))])
    print("Jet4 Raw Decoded (repr):", repr(j4_raw))
    
find_password(r"data\easyquran\EasyQuran.dat")
find_password(r"data\easyquran\EasyHadees.dat")
