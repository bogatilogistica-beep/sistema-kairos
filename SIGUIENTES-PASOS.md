# Próximos pasos (lo único que falta hacer manualmente)

Todo el código, los datos limpios y el motor de rutas ya están listos, probados y
commiteados en git localmente. Esto es exactamente lo que necesitas hacer tú — no pude
hacerlo yo porque requiere tus cuentas/credenciales.

## 1. Subir el repo a GitHub

El proyecto está en `C:\Users\BOG-OP-DA\Desktop\AGENTE IA\bogati-rutas`, con 2 commits
locales ya hechos (`git log` para verlos). Para subirlo:

1. Crea un repositorio vacío en GitHub (ej. `bogati-rutas`), **sin** README/gitignore
   (ya los tenemos).
2. En una terminal, dentro de esa carpeta:
   ```powershell
   git remote add origin https://github.com/<tu-usuario>/bogati-rutas.git
   git branch -M main
   git push -u origin main
   ```
   Si te pide login, usa un Personal Access Token de GitHub como contraseña (no tu
   contraseña normal): GitHub → Settings → Developer settings → Personal access tokens.

## 2. Desplegar en Vercel

1. Entra a vercel.com con tu cuenta (o crea una, es gratis para este uso).
2. "Add New Project" → importa el repo `bogati-rutas` que acabas de subir a GitHub.
3. Framework se detecta solo como Next.js. No necesitas tocar nada más — dale "Deploy".
4. En 1-2 minutos tendrás una URL pública tipo `bogati-rutas.vercel.app`.

## 3. (Opcional, recomendado) Distancias reales con Google Maps o Mapbox

Sin esto, la plataforma ya funciona bien (usa coordenadas GPS + un factor de corrección
vial). Con esto, las distancias y tiempos de viaje son exactos (calles reales, tráfico
típico):

- **Mapbox** (más simple, capa gratuita generosa, no pide tarjeta para empezar):
  1. Crea cuenta en mapbox.com → copia tu "Default public token".
  2. En Vercel: Project Settings → Environment Variables → agrega `MAPBOX_TOKEN` con ese
     valor → Redeploy.
- **Google Maps** (más preciso en Ecuador, requiere cuenta de facturación aunque tiene
  capa gratuita mensual):
  1. Google Cloud Console → habilita "Distance Matrix API" → crea una API key.
  2. En Vercel: agrega `GOOGLE_MAPS_API_KEY` con esa key → Redeploy.

No necesitas cambiar nada en el código: la plataforma detecta sola cuál variable existe
y la usa automáticamente.

## 4. Revisar los hallazgos de calidad de datos

Al cruzar los archivos encontré algunas inconsistencias reales en los datos fuente. Ya
están corregidas o marcadas dentro de la plataforma (pestaña **Red de PDV**), pero vale
la pena que las confirmes:

- **"CAÑR AZOGUES AV. 10 DE AGOSTO"**: su coordenada en la matriz está corrupta
  (`27.402.491,- 78,8486551,18.25` — no es un par de coordenadas válido). Usé
  temporalmente la coordenada del otro PDV de Azogues como aproximación. Corrige la
  coordenada real en la matriz cuando puedas.
- **5 PDV con corrección automática de signo de latitud** (típico error al copiar y
  pegar desde Google Maps sin el signo negativo): los 4 de Cotopaxi
  (Latacunga x2, Salcedo, Saquisilí) y La Maná. Verifiqué que la corrección los deja en
  la ubicación correcta comparando contra la planta de Ambato, pero confírmalo en
  Google Maps si quieres estar 100% segura.
- **3 PDV activos en la matriz de ubicaciones pero sin ruta asignada** en RUTAS DE
  TRANSPORTE 2026: `COTX LATACUNGA SUR AV. QUIJANO` (aparece como CERRADO en COBRO DE
  TRANSPORTE — ¿sigue operando?), `SUCU LAGO AGRIO AV. VENEZUELA` (posible diferencia de
  puntuación con el nombre en RUTAS) y `AZUY PAUTE` (PDV nuevo, parece no tener ruta
  asignada todavía). Mientras no tengan ruta, la plataforma igual los puede rutear (usa
  la provincia), pero no aparecerán agrupados bajo un código de ruta conocido.

Todo esto está documentado también en `data/data-quality-report.json` y visible en la
pestaña "Red de PDV" de la plataforma.

## 5. Antes de usarla en serio

- Revisa en `/config` que la capacidad de camión (3,500 kg), la fórmula de costo y la
  ubicación de la planta (aproximada desde la dirección de Ambato) sean correctas.
- Prueba con un pedido real de una semana (usa el botón "Descargar plantilla" en
  `/optimizar` como guía de formato) antes de usar los números para tomar decisiones o
  para el informe del concurso.
- Los archivos originales de Excel (con datos sensibles de clientes/facturación) están
  en `bogati-rutas/source-data-raw/` — **no se suben a git** (ya está en
  `.gitignore`), pero si compartes la carpeta del proyecto con alguien, bórralos o
  muévelos antes.

## Cómo correrla en tu computadora mientras tanto

```powershell
cd "C:\Users\BOG-OP-DA\Desktop\AGENTE IA\bogati-rutas"
$env:PATH += ";C:\tools\nodejs"
npx next dev
```
Y abre http://localhost:3000 — no necesitas esperar a Vercel para probarla.
