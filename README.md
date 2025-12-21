# VakarosLive (Atlas 2) — Telemetría en tiempo real

Este proyecto crea un **bridge BLE → Web** para recibir telemetría del **Vakaros Atlas 2** y verla en tiempo real desde cualquier móvil (navegador) conectado a la misma red.

## Requisitos

- Windows/macOS/Linux con Bluetooth (para conectar al Atlas 2)
- Python 3.11+ (probado con 3.13)

## Instalación

```powershell
cd C:\JAVIER\VAKAROSLIVE
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

## Uso

1) Asegúrate de que el Atlas 2 está “despierto” (abre Vakaros Connect unos segundos si hace falta).
2) Arranca el servidor:

```powershell
python -m vakaroslive --host 0.0.0.0 --port 8000
```

3) Desde el móvil, abre: `http://IP_DEL_PC:8000`

## Flags útiles

- `--device <address>`: conecta a una dirección concreta (si el auto-scan no lo encuentra).
- `--mock`: genera telemetría falsa para probar la UI sin dispositivo.

## Marcas y salida

- **Marca**: “Guardar marca” guarda la posición actual y muestra distancia + bearing.
- **Salida**: “Set PIN/RCB” guarda los dos extremos de la línea; se calcula distancia a línea y ETA.
- Se guardan automáticamente en `logs/vakaroslive_state.json` para que estén disponibles al reiniciar.

## Notas

- El protocolo BLE está basado en ingeniería inversa; algunos campos aún no están confirmados.
- Si el Atlas 2 está conectado a Vakaros Connect, es posible que **no envíe telemetría** a esta app (prueba a desconectar/cerrar Vakaros Connect).

## Android (sin PC para BLE) – Opción B

El dashboard incluye un modo **BLE directo**: el **móvil/tablet Android** se conecta por **Web Bluetooth** al Atlas 2 (sin necesidad de que el PC mantenga la conexión BLE).

Requisitos:
- Android + Chrome/Edge.
- iPhone/iPad (Safari) no soporta Web Bluetooth.

### Web Bluetooth exige HTTPS

Chrome solo permite BLE si la web se abre en un **contexto seguro (HTTPS)** (o `http://localhost`).

Para uso real, lo más cómodo es:
1) Publicar la web en un dominio HTTPS (GitHub Pages / Netlify / etc).
2) Abrirla en el móvil y **Añadir a pantalla de inicio** (PWA).
3) Luego puede abrirse incluso sin Internet (cache del service worker) y seguirá pudiendo conectar por BLE.

### HTTPS local (para pruebas)

Si quieres probarlo sirviendo desde tu PC en casa, el servidor soporta HTTPS:

```powershell
python -m vakaroslive --host 0.0.0.0 --port 8766 --https --certfile cert.pem --keyfile key.pem
```

Abre en el móvil `https://IP_DEL_PC:8766/` y pulsa **Conectar BLE (móvil)**.

Nota: si el certificado no es confiable para Android/Chrome, Web Bluetooth seguirá bloqueado aunque aceptes el aviso.
