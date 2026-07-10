#!/bin/bash
cd "$(dirname "$0")"
# mata servidor anterior se existir
pkill -f "http.server 8767" 2>/dev/null
# inicia o servidor em background
python3 -m http.server 8767 &>/dev/null &
sleep 0.5
# abre no Chrome
open -a "Google Chrome" "http://localhost:8767"
