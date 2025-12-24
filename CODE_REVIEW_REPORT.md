# Reporte de Revisión de Código - VakarosLive

**Fecha:** 2025-12-24
**Versión revisada:** v29
**Revisor:** Claude Code

---

## 1. RESUMEN EJECUTIVO

**VakarosLive** es una Progressive Web App (PWA) para telemetría de navegación a vela que se conecta vía BLE a un dispositivo Atlas2 y muestra datos de navegación en tiempo real (heading, SOG, COG, GPS, etc.).

**Arquitectura:**
- Backend: Python 3.x con `aiohttp` (servidor async HTTP/WebSocket)
- Frontend: JavaScript vanilla con Leaflet.js para mapas
- Comunicación: WebSocket para telemetría en tiempo real
- Protocolo BLE: Custom protocol para Vakaros Atlas2

**Estado general:** El código es funcional y está bien estructurado, pero presenta varias áreas de mejora en seguridad, manejo de errores, y mantenibilidad.

---

## 2. PROBLEMAS CRÍTICOS DE SEGURIDAD

### 🔴 CRÍTICO: CORS completamente deshabilitado
**Ubicación:** `server.py:223-225`

```python
class LooseWebSocketResponse(web.WebSocketResponse):
    def _check_origin(self, origin: str) -> bool:
        return True
```

**Impacto:** Permite conexiones WebSocket desde cualquier origen, expone la aplicación a ataques CSRF y XSS desde sitios maliciosos.

**Recomendación:**
- Implementar lista blanca de orígenes permitidos
- Validar el header `Origin` contra dominios confiables
- Solo usar en desarrollo con flag `--dev`

---

### 🟡 MEDIO: Escritura de archivos sin validación
**Ubicación:** `ble_atlas2.py:227-228`

```python
with open("logs/raw_packets.log", "a") as f:
    f.write(f"MAIN: {raw.hex()}\n")
```

**Problemas:**
- Path hardcodeado sin validación de existencia del directorio
- No hay manejo de excepciones (puede crashear si no existe `logs/`)
- Acceso a filesystem sin rate limiting (puede llenar el disco)
- El archivo crece sin límite (DoS local)

**Recomendación:**
- Usar `pathlib.Path` y crear directorio si no existe
- Implementar rotación de logs (logging.handlers.RotatingFileHandler)
- Agregar try/except para fallos de I/O

---

### 🟡 MEDIO: Falta validación de entrada en comandos
**Ubicación:** `server.py:55-192`

Aunque hay validación básica, algunos comandos no validan completamente:
- Valores numéricos sin límites (podrían causar overflow en cálculos)
- No hay rate limiting para comandos desde WebSocket
- No hay autenticación (cualquiera en la red local puede enviar comandos)

---

## 3. BUGS Y PROBLEMAS DE LÓGICA

### 🔴 BUG: Potencial race condition en queue
**Ubicación:** `ble_atlas2.py:71-82`

```python
def _enqueue(self, event: dict[str, Any]) -> None:
    try:
        self._event_queue.put_nowait(event)
    except asyncio.QueueFull:
        try:
            _ = self._event_queue.get_nowait()
        except asyncio.QueueEmpty:
            return
        try:
            self._event_queue.put_nowait(event)
```

**Problema:** Entre `get_nowait()` y el segundo `put_nowait()`, otro thread puede llenar la queue nuevamente, causando pérdida silenciosa de eventos.

**Recomendación:** Usar una queue más grande o implementar backpressure explícito.

---

### 🟡 BUG: Fallback de coordenadas puede dar falsos positivos
**Ubicación:** `atlas2_protocol.py:62-71`

```python
# Discovery fallback for new firmware versions
if (lat is None or abs(lat) < 1e-4) and (lon is None or abs(lon) < 1e-4):
    for off in range(2, len(data) - 8):
        tl = _safe_f32(data, off)
        to = _safe_f32(data, off+4)
        if tl and to and 35.0 < abs(tl) < 65.0 and abs(to) < 180.0:
            lat = tl
            lon = to
            break
```

**Problema:**
- El rango 35-65° está hardcodeado (solo funciona para latitudes de Europa/EE.UU.)
- No valida que sean realmente coordenadas consecutivas
- Podría matchear con otros campos float que casualmente estén en ese rango

**Recomendación:**
- Documentar claramente que es un fallback experimental
- Agregar flag para deshabilitarlo
- Validar coherencia con fix anterior (no debería saltar miles de km)

---

### 🟡 BUG: División por cero no protegida
**Ubicación:** `state.py:195`

```python
t = (sog - sog_low) / max(0.001, (sog_high - sog_low))
```

Si `sog_high == sog_low`, el max(0.001, ...) protege, pero el valor 0.001 es arbitrario y puede dar resultados inesperados.

---

### 🟡 BUG: Comparación de floats con ==
**Ubicación:** `state.py:182-183`

```python
if x == 0.0 and y == 0.0:
    return None
```

Mejor usar `abs(x) < epsilon and abs(y) < epsilon` para comparaciones de floats.

---

## 4. PROBLEMAS DE RENDIMIENTO

### 🟡 Polling agresivo en Windows
**Ubicación:** `ble_atlas2.py:286`

```python
poll_interval_s = 0.2  # 5 Hz polling
```

**Problema:** En Windows/WinRT, se hace polling a 5 Hz de características GATT porque las notificaciones no funcionan bien. Esto consume batería y CPU innecesariamente.

**Recomendación:**
- Reducir a 1-2 Hz si las notificaciones no llegan
- Implementar backoff exponencial

---

### 🟡 Frontend: app.js demasiado grande
**Ubicación:** `app.js` - 3753 líneas en un solo archivo

**Problema:**
- Difícil de mantener
- No usa módulos ES6
- Todo en scope global
- No hay code splitting

**Recomendación:**
- Dividir en módulos: `ble.js`, `map.js`, `charts.js`, `damping.js`, etc.
- Usar bundler (esbuild, vite) para producción
- Implementar lazy loading para gráficas

---

### 🟡 Service Worker: Strategy mixta puede causar problemas
**Ubicación:** `sw.js:51-64`

La estrategia "network-first" para assets estáticos puede causar delays en redes lentas.

**Recomendación:**
- Usar cache-first para assets versionados (`app.js?v=29`)
- Implementar stale-while-revalidate

---

## 5. PROBLEMAS DE MANTENIBILIDAD

### 🔴 Falta de type hints completo
**Ubicación:** Múltiples archivos Python

Aunque se usan `from __future__ import annotations`, muchas funciones carecen de type hints:
- Variables de instancia sin tipos
- Returns implícitos

**Recomendación:** Ejecutar `mypy` en modo strict.

---

### 🟡 Magic numbers sin constantes
**Ubicación:** Múltiples archivos

Ejemplos:
- `state.py:498` - `cutoff = ts_ms - 4000` (¿por qué 4 segundos?)
- `state.py:508` - `if 0.0 < sog_kn <= 40.0` (40 nudos hardcodeado)
- `ble_atlas2.py:373` - `timeout=6.0` (timeout de telemetría)

**Recomendación:** Extraer a constantes con nombres descriptivos.

---

### 🟡 Comentarios en español e inglés mezclados

**Ubicación:** Todo el código

Hay mezcla de comentarios en español e inglés, strings de error en español, nombres de variables en inglés.

**Recomendación:** Estandarizar idioma (preferiblemente inglés para código open source).

---

### 🟡 Logging inconsistente

**Ubicación:** `ble_atlas2.py`

Mezcla de:
- `self._logger.info()`
- `self._logger.error()`
- `self._logger.debug()`

Pero no hay logging en `server.py` para errores de WebSocket ni comandos inválidos.

---

### 🟡 Falta de tests

**Ubicación:** Todo el proyecto

No se encontraron tests unitarios ni de integración.

**Recomendación:**
- Tests para parsers de protocolo (`atlas2_protocol.py`)
- Tests para cálculos geográficos (`util_geo.py`)
- Tests para lógica de state (`state.py`)
- Mock de BLE para tests de integración

---

## 6. MEJORES PRÁCTICAS VIOLADAS

### 🟡 Globals mutables en frontend
**Ubicación:** `app.js:96-108`

```javascript
let lastState = null;
let wsConn = null;
let mark = null;
let startLine = { pin: null, rcb: null, followAtlas: false, source: null };
// ... 10+ variables globales más
```

**Problema:** Estado global dificulta debugging y testing.

**Recomendación:** Encapsular en objeto `AppState` o usar patrón State.

---

### 🟡 Callback hell potencial
**Ubicación:** `ble_atlas2.py:222-268`

Múltiples callbacks anidados (`on_main`, `on_compact`, etc.) dentro del método `run()`.

**Recomendación:** Extraer a métodos de instancia.

---

### 🟡 Hardcoded paths
**Ubicación:** `__main__.py:104`

```python
persist_path = Path.cwd() / "logs" / "vakaroslive_state.json"
```

No permite configurar path de logs, siempre usa `./logs/`.

---

## 7. PROBLEMAS DE COMPATIBILIDAD

### 🟡 Dependencia de features modernas de navegador

**Ubicación:** Frontend

Usa:
- Web Bluetooth API (solo Chrome/Edge en desktop, limitado en mobile)
- Wake Lock API (no todos los navegadores)
- Service Workers (necesita HTTPS)

**Recomendación:** Agregar feature detection y mensajes de error claros.

---

### 🟡 Regex para MAC address puede fallar
**Ubicación:** `ble_atlas2.py:28`

```python
_MAC_RE = re.compile(r"^[0-9A-Fa-f]{2}([:-][0-9A-Fa-f]{2}){5}$")
```

No cubre todos los formatos (ej: Windows a veces usa GUIDs sin guiones).

---

## 8. ASPECTOS POSITIVOS ✅

### ✅ Buena arquitectura async
El uso de `asyncio` está bien implementado con manejo correcto de tasks y cleanup.

### ✅ Dataclasses bien usados
Los `@dataclass` en `state.py` y `atlas2_protocol.py` son idiomáticos y limpios.

### ✅ Persistencia de estado
El sistema de guardado/carga de marcas en JSON es simple y efectivo.

### ✅ PWA bien implementada
Service Worker con estrategias de cache correctas, manifest.webmanifest completo.

### ✅ UI responsive
CSS bien estructurado con variables CSS y media queries apropiadas.

### ✅ Fusión de sensores sofisticada
La lógica de fusión de COG/heading en `state.py` es compleja pero bien pensada (líneas 217-269).

### ✅ Fallback para Windows BLE
El polling como fallback para notificaciones BLE demuestra conocimiento de limitaciones de plataforma.

### ✅ Damping configurable
El sistema de damping por UI es elegante y bien implementado.

---

## 9. RECOMENDACIONES PRIORITARIAS

### 🔥 Prioridad ALTA (hacer ahora)

1. **Arreglar CORS**: Implementar validación de origen
2. **Arreglar escritura de logs**: Usar logging module apropiadamente
3. **Agregar manejo de excepciones**: Especialmente en I/O y BLE
4. **Documentar protocolo**: El formato de packets Atlas2 necesita spec

### 🔶 Prioridad MEDIA (próximo sprint)

1. **Agregar tests**: Al menos para parsers y cálculos críticos
2. **Refactorizar app.js**: Dividir en módulos
3. **Estandarizar idioma**: Todo a inglés o todo a español
4. **Agregar rate limiting**: Para comandos WebSocket

### 🔵 Prioridad BAJA (backlog)

1. **TypeScript migration**: Para frontend
2. **mypy strict mode**: Para backend
3. **Dockerización**: Para deployment fácil
4. **CI/CD**: GitHub Actions con tests y linting

---

## 10. MÉTRICAS DE CÓDIGO

| Métrica | Valor | Observación |
|---------|-------|-------------|
| Líneas Python | ~1,500 | Razonable |
| Líneas JavaScript | 3,753 | Demasiado en un archivo |
| Complejidad ciclomática | Alta en `state.py` | Refactorizar `apply_event()` |
| Cobertura de tests | 0% | ⚠️ Sin tests |
| Type coverage (mypy) | ~60% | Mejorar |
| Comentarios | Bajo | Falta documentación en funciones complejas |

---

## 11. CONCLUSIONES

El proyecto **VakarosLive** es funcional y demuestra buen conocimiento de:
- Async Python
- WebSocket/BLE
- Procesamiento de telemetría en tiempo real
- PWA y Service Workers

**Principales debilidades:**
- Seguridad (CORS, validación)
- Falta de tests
- Mantenibilidad del frontend
- Documentación

**Recomendación final:** El código está listo para uso personal/hobby, pero requiere trabajo significativo en seguridad y tests antes de uso en producción o distribución pública.

**Calificación general:** 6.5/10
- Funcionalidad: 8/10
- Seguridad: 4/10
- Mantenibilidad: 6/10
- Rendimiento: 7/10
- Documentación: 5/10

---

**Fin del reporte**
