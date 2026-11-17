# Formato de Inventario y Evidencias · Mantenimiento Preventivo

Aplicación web estática (100% client-side) con diseño minimalista inspirado en Google Material, modo claro/oscuro y generador de PDF sin dependencias externas.

## Funcionalidades

- **Formato de Inventario (Versión 3)** editable directamente en pantalla (`Empresa`, `No. Ticket`, `Usuario`, `Fecha`, descripción completa del equipo, `Antivirus`, checklist `SI / NO`, `Estado del Equipo`, `Observaciones` y firmas digitales dibujables).
- **Interruptor `Formato de inventario`**: permite activar o desactivar el Formato de Inventario en cualquier momento manteniendo intactas las 12 evidencias fotográficas cargadas.
- **Carga de evidencias fotográficas**: selección de archivos, arrastrar y soltar o pegado directo con `Ctrl + V`, con notas opcionales por fotografía.
- **Generación de PDF en el navegador**: exporta un documento PDF con la Página 1 del Formato de Inventario (cuando está activo) seguido de todas las evidencias fotográficas adjuntas.
- **Modo oscuro / claro** persistente y guardado automático de borradores en `IndexedDB`.
- **Editor de PDF en bruto** (pestaña `Editor de PDF`): permite cargar cualquier PDF (o usar la plantilla integrada de 2 páginas *Reporte de Asistencia + Formato de Inventario*), insertar y editar cuadros de texto, marcar casillas (`X` / `✓`), dibujar firmas a mano alzada, cubrir texto con borrador blanco, insertar imágenes y exportar el PDF final con opción de anexar las evidencias fotográficas cargadas.

## Uso local en Windows

Haz doble clic en `Iniciar_Pagina.bat` (o abre `index.html` directamente en tu navegador).
