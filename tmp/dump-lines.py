import io
s = io.open('scripts/verify-i18n-parity.ts', 'rb').read().decode('utf8')
lines = s.replace('\r\n', '\n').split('\n')
for i in range(465, min(475, len(lines))):
    print(i+1, repr(lines[i][:120]))
