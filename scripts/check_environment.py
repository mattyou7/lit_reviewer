import sys
print('Python:', sys.version)
for name in ['pypdf', 'mlx', 'mlx_lm']:
    try:
        mod = __import__(name)
        print(f'{name}: OK')
    except Exception as e:
        print(f'{name}: MISSING ({e})')
