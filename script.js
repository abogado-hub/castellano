/* =========================================================
   MENÚ CHEF JESÚS — script.js
   Menú interactivo (solo consulta) + panel de administración
   Base de datos: Supabase (tablas cj_secciones y cj_platillos)
   ========================================================= */

// ---------- 1. CONFIGURACIÓN ----------
const CONFIG = {
  nombreRestaurante: "Chef Jesús",
  lema: "Cocina de autor",
  supabaseUrl: "https://gzthhlxowzvbybreygsz.supabase.co",
  supabaseKey: "sb_publishable_MzP7h6tDWVijMaCWI8pIaw_Asz8f9lF", // clave pública (segura para el navegador)
  intervaloRefresco: 60000, // el menú se actualiza solo cada 60 s
};

const db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

// ---------- 2. ESTADO DE LA APLICACIÓN ----------
const estado = {
  secciones: [],
  platillos: [],
  busqueda: "",
  pin: null,              // se guarda solo en memoria mientras el panel está abierto
  editandoPlatillo: null, // id del platillo en edición (null = nuevo)
  editandoSeccion: null,
  fotoActual: "",         // foto (data URL o URL) del formulario
};

// ---------- 3. UTILIDADES ----------
const $ = (sel) => document.querySelector(sel);

const formatoPrecio = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const precio = (n) => formatoPrecio.format(Number(n) || 0);

// true si el dispositivo tiene mouse (computadora); false en celulares y tablets
const esComputadora = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

// Evita que un texto con etiquetas HTML rompa la página
function escapar(texto = "") {
  return String(texto).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function htmlFoto(platillo) {
  if (platillo.foto) return `<img src="${escapar(platillo.foto)}" alt="${escapar(platillo.nombre)}" loading="lazy" />`;
  return `<div class="sin-foto">${escapar(platillo.nombre.charAt(0).toUpperCase())}</div>`;
}

let temporizadorToast;
function aviso(mensaje, esError = false) {
  const t = $("#toast");
  t.textContent = mensaje;
  t.classList.toggle("error-toast", esError);
  t.classList.add("visible");
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => t.classList.remove("visible"), 2800);
}

function mensajeError(error) {
  const msg = error?.message || String(error);
  return msg.includes("PIN incorrecto") ? "PIN incorrecto, vuelve a entrar." : msg;
}

// ---------- 4. BASE DE DATOS ----------
async function cargarDatos() {
  const [rs, rp] = await Promise.all([
    db.from("cj_secciones").select("*").order("orden").order("nombre"),
    db.from("cj_platillos").select("*").order("orden").order("nombre"),
  ]);
  if (rs.error || rp.error) throw rs.error || rp.error;
  estado.secciones = rs.data;
  estado.platillos = rp.data;
}

// Todas las escrituras pasan por funciones protegidas con PIN en la base de datos
async function rpc(funcion, parametros) {
  const { data, error } = await db.rpc(funcion, { p_pin: estado.pin, ...parametros });
  if (error) throw error;
  return data;
}

// ---------- 5. VISTA MENÚ (CLIENTE) ----------
function seccionesVisibles() {
  return estado.secciones.filter((s) => s.activo && estado.platillos.some((p) => p.seccion_id === s.id));
}

function renderMenu() {
  const cont = $("#contenedor-menu");
  const nav = $("#nav-secciones");
  const q = estado.busqueda.trim().toLowerCase();
  const secciones = seccionesVisibles();

  // Barra de secciones
  nav.innerHTML = secciones
    .map((s) => `<button class="chip" data-ir="${s.id}">${escapar(s.nombre)}</button>`)
    .join("");

  if (!secciones.length) {
    cont.innerHTML = `<div class="vacio">El menú se está preparando…</div>`;
    return;
  }

  let html = "";
  let retraso = 0;
  for (const s of secciones) {
    const platillos = estado.platillos.filter(
      (p) => p.seccion_id === s.id &&
        (!q || p.nombre.toLowerCase().includes(q) || (p.descripcion || "").toLowerCase().includes(q))
    );
    if (!platillos.length) continue;

    html += `
      <section class="seccion-menu" id="sec-${s.id}" data-seccion="${s.id}">
        <div class="seccion-encabezado">
          <h2>${escapar(s.nombre)}</h2>
          ${s.descripcion ? `<p>${escapar(s.descripcion)}</p>` : ""}
          <div class="linea-dorada"></div>
        </div>
        <div class="rejilla">
          ${platillos.map((p) => {
            retraso += 0.04;
            return `
            <article class="tarjeta ${p.disponible ? "" : "agotado"}" data-platillo="${p.id}" style="animation-delay:${Math.min(retraso, 0.8)}s">
              <div class="tarjeta-foto">
                ${htmlFoto(p)}
                ${!p.disponible ? `<span class="etiqueta gris">No disponible</span>`
                  : p.destacado ? `<span class="etiqueta">★ Del chef</span>` : ""}
              </div>
              <div class="tarjeta-cuerpo">
                <div class="tarjeta-titulo">
                  <h3>${escapar(p.nombre)}</h3>
                  <span class="precio">${precio(p.precio)}</span>
                </div>
                ${p.descripcion ? `<p class="tarjeta-desc">${escapar(p.descripcion)}</p>` : ""}
              </div>
            </article>`;
          }).join("")}
        </div>
      </section>`;
  }

  cont.innerHTML = html || `<div class="vacio">No encontramos platillos con “${escapar(estado.busqueda)}”.</div>`;
  observarSecciones();
}

function abrirDetalle(id) {
  const p = estado.platillos.find((x) => x.id === id);
  if (!p) return;
  const s = estado.secciones.find((x) => x.id === p.seccion_id);
  $("#detalle-foto").innerHTML = htmlFoto(p);
  $("#detalle-seccion").textContent = s ? s.nombre : "";
  $("#detalle-nombre").textContent = p.nombre;
  $("#detalle-precio").textContent = precio(p.precio) + (p.disponible ? "" : " · No disponible");
  $("#detalle-descripcion").textContent = p.descripcion || "";
  abrirCapa("#modal-detalle");
}

// Resalta en la barra la sección que se está viendo
let observador;
function observarSecciones() {
  observador?.disconnect();
  observador = new IntersectionObserver((entradas) => {
    entradas.forEach((e) => {
      if (!e.isIntersecting) return;
      document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("activo", c.dataset.ir === e.target.dataset.seccion));
      document.querySelector(".chip.activo")?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    });
  }, { rootMargin: "-40% 0px -55% 0px" });
  document.querySelectorAll(".seccion-menu").forEach((s) => observador.observe(s));
}

// ---------- 6. NAVEGACIÓN ENTRE VISTAS ----------
function mostrarVista(vista) {
  $("#vista-menu").classList.toggle("oculto", vista !== "menu");
  $("#vista-admin").classList.toggle("oculto", vista !== "admin");
  window.scrollTo(0, 0);
  if (vista === "menu") renderMenu();
}

function irA(hash) {
  if (location.hash !== hash) location.hash = hash;
  else enrutar();
}

function enrutar() {
  mostrarVista(location.hash === "#admin" ? "admin" : "menu");
  if (location.hash === "#admin") {
    $("#admin-login").classList.toggle("oculto", !!estado.pin);
    $("#admin-panel").classList.toggle("oculto", !estado.pin);
    if (estado.pin) renderAdmin();
  }
}

// ---------- 7. ADMINISTRACIÓN: ACCESO ----------
async function iniciarSesion(e) {
  e.preventDefault();
  const pin = $("#input-pin").value.trim();
  const btn = e.submitter;
  btn.disabled = true;
  $("#login-error").textContent = "";
  const { data, error } = await db.rpc("cj_verificar_pin", { p_pin: pin });
  btn.disabled = false;
  if (error || !data) {
    $("#login-error").textContent = error ? "No se pudo conectar." : "PIN incorrecto.";
    return;
  }
  estado.pin = pin;
  $("#input-pin").value = "";
  enrutar();
}

function cerrarSesion() {
  estado.pin = null;
  irA("#");
}

// ---------- 8. ADMINISTRACIÓN: LISTAS ----------
function renderAdmin() {
  renderFiltroSecciones();
  renderListaPlatillos();
  renderListaSecciones();
}

function opcionesSecciones(seleccionada = "") {
  return estado.secciones
    .map((s) => `<option value="${s.id}" ${s.id === seleccionada ? "selected" : ""}>${escapar(s.nombre)}</option>`)
    .join("");
}

function renderFiltroSecciones() {
  const actual = $("#filtro-seccion").value;
  $("#filtro-seccion").innerHTML = `<option value="">Todas las secciones</option>` + opcionesSecciones(actual);
}

function renderListaPlatillos() {
  const filtro = $("#filtro-seccion").value;
  const secciones = estado.secciones.filter((s) => !filtro || s.id === filtro);
  const lista = $("#lista-platillos");

  if (!estado.secciones.length) {
    lista.innerHTML = `<div class="vacio">Primero crea una sección en la pestaña “Secciones”.</div>`;
    return;
  }

  lista.innerHTML = secciones.map((s) => {
    const platillos = estado.platillos.filter((p) => p.seccion_id === s.id);
    return `
      <h3 class="grupo-admin-titulo">${escapar(s.nombre)} <small style="color:var(--gris-medio);font-size:.9rem">(${platillos.length})</small></h3>
      ${platillos.length ? platillos.map((p) => `
        <div class="fila-admin ${p.disponible ? "" : "inactiva"}">
          <div class="mini-foto">${htmlFoto(p)}</div>
          <div class="fila-info">
            <strong>${p.destacado ? "★ " : ""}${escapar(p.nombre)}</strong>
            <small>${p.disponible ? "Disponible" : "No disponible"}</small>
          </div>
          <span class="fila-precio">${precio(p.precio)}</span>
          <label class="switch" title="Disponible">
            <input type="checkbox" data-toggle-platillo="${p.id}" ${p.disponible ? "checked" : ""} /><span></span>
          </label>
          <div class="fila-acciones">
            <button class="btn-icono" data-editar-platillo="${p.id}" title="Editar">✎</button>
            <button class="btn-icono peligro" data-borrar-platillo="${p.id}" title="Eliminar">🗑</button>
          </div>
        </div>`).join("")
      : `<p class="nota">Sin platillos en esta sección.</p>`}`;
  }).join("");
}

function renderListaSecciones() {
  const lista = $("#lista-secciones");
  if (!estado.secciones.length) {
    lista.innerHTML = `<div class="vacio">Aún no hay secciones.</div>`;
    return;
  }
  lista.innerHTML = estado.secciones.map((s) => {
    const total = estado.platillos.filter((p) => p.seccion_id === s.id).length;
    return `
      <div class="fila-admin ${s.activo ? "" : "inactiva"}">
        <div class="fila-info">
          <strong>${escapar(s.nombre)}</strong>
          <small>${total} platillo${total === 1 ? "" : "s"} · orden ${s.orden}${s.descripcion ? " · " + escapar(s.descripcion) : ""}</small>
        </div>
        <label class="switch" title="Visible en el menú">
          <input type="checkbox" data-toggle-seccion="${s.id}" ${s.activo ? "checked" : ""} /><span></span>
        </label>
        <div class="fila-acciones">
          <button class="btn-icono" data-editar-seccion="${s.id}" title="Editar">✎</button>
          <button class="btn-icono peligro" data-borrar-seccion="${s.id}" title="Eliminar">🗑</button>
        </div>
      </div>`;
  }).join("");
}

async function recargarAdmin() {
  await cargarDatos();
  renderAdmin();
}

// ---------- 9. ADMINISTRACIÓN: PLATILLOS ----------
function abrirFormPlatillo(id = null) {
  if (!estado.secciones.length) return aviso("Crea primero una sección.", true);
  const p = estado.platillos.find((x) => x.id === id);
  estado.editandoPlatillo = id;
  $("#titulo-form-platillo").textContent = p ? "Editar platillo" : "Nuevo platillo";
  $("#p-nombre").value = p?.nombre || "";
  $("#p-seccion").innerHTML = opcionesSecciones(p?.seccion_id || $("#filtro-seccion").value);
  $("#p-precio").value = p?.precio ?? "";
  $("#p-descripcion").value = p?.descripcion || "";
  $("#p-orden").value = p?.orden ?? 0;
  $("#p-disponible").checked = p ? p.disponible : true;
  $("#p-destacado").checked = p ? p.destacado : false;
  $("#p-foto-url").value = p?.foto && !p.foto.startsWith("data:") ? p.foto : "";
  ponerFoto(p?.foto || "");
  abrirCapa("#cajon-platillo");
  // En computadora pone el cursor en el nombre; en celular no, para que no salte el teclado
  if (esComputadora()) setTimeout(() => $("#p-nombre").focus(), 50);
}

function ponerFoto(foto) {
  estado.fotoActual = foto;
  $("#p-vista-previa").innerHTML = foto ? `<img src="${escapar(foto)}" alt="Vista previa" />` : `<span>Sin foto</span>`;
}

// Reduce la foto (máx. 900 px, JPG) para que cargue rápido y quepa en la base de datos
function comprimirImagen(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = reject;
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("La imagen no es válida"));
      img.onload = () => {
        const max = 900;
        const escala = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      img.src = lector.result;
    };
    lector.readAsDataURL(archivo);
  });
}

async function guardarPlatillo(e) {
  e.preventDefault();
  const btn = $("#btn-guardar-platillo");
  btn.disabled = true;
  try {
    await rpc("cj_guardar_platillo", {
      p_id: estado.editandoPlatillo,
      p_seccion_id: $("#p-seccion").value,
      p_nombre: $("#p-nombre").value,
      p_descripcion: $("#p-descripcion").value.trim(),
      p_precio: Number($("#p-precio").value),
      p_foto: estado.fotoActual || null,
      p_disponible: $("#p-disponible").checked,
      p_destacado: $("#p-destacado").checked,
      p_orden: Number($("#p-orden").value) || 0,
    });
    cerrarCapas();
    aviso(estado.editandoPlatillo ? "Platillo actualizado" : "Platillo agregado");
    await recargarAdmin();
  } catch (err) {
    aviso(mensajeError(err), true);
  } finally {
    btn.disabled = false;
  }
}

async function alternarPlatillo(id, disponible) {
  const p = estado.platillos.find((x) => x.id === id);
  try {
    await rpc("cj_guardar_platillo", {
      p_id: p.id, p_seccion_id: p.seccion_id, p_nombre: p.nombre, p_descripcion: p.descripcion,
      p_precio: p.precio, p_foto: p.foto, p_disponible: disponible, p_destacado: p.destacado, p_orden: p.orden,
    });
    aviso(disponible ? "Marcado como disponible" : "Marcado como no disponible");
  } catch (err) {
    aviso(mensajeError(err), true);
  }
  await recargarAdmin();
}

async function borrarPlatillo(id) {
  const p = estado.platillos.find((x) => x.id === id);
  if (!confirm(`¿Eliminar “${p.nombre}” del menú?`)) return;
  try {
    await rpc("cj_eliminar_platillo", { p_id: id });
    aviso("Platillo eliminado");
    await recargarAdmin();
  } catch (err) {
    aviso(mensajeError(err), true);
  }
}

// ---------- 10. ADMINISTRACIÓN: SECCIONES ----------
function abrirFormSeccion(id = null) {
  const s = estado.secciones.find((x) => x.id === id);
  estado.editandoSeccion = id;
  $("#titulo-form-seccion").textContent = s ? "Editar sección" : "Nueva sección";
  $("#s-nombre").value = s?.nombre || "";
  $("#s-descripcion").value = s?.descripcion || "";
  $("#s-orden").value = s?.orden ?? (Math.max(0, ...estado.secciones.map((x) => x.orden)) + 1);
  $("#s-activo").checked = s ? s.activo : true;
  abrirCapa("#cajon-seccion");
  // En computadora pone el cursor en el nombre; en celular no, para que no salte el teclado
  if (esComputadora()) setTimeout(() => $("#s-nombre").focus(), 50);
}

async function guardarSeccion(e) {
  e.preventDefault();
  const btn = e.submitter;
  btn.disabled = true;
  try {
    await rpc("cj_guardar_seccion", {
      p_id: estado.editandoSeccion,
      p_nombre: $("#s-nombre").value,
      p_descripcion: $("#s-descripcion").value.trim(),
      p_orden: Number($("#s-orden").value) || 0,
      p_activo: $("#s-activo").checked,
    });
    cerrarCapas();
    aviso(estado.editandoSeccion ? "Sección actualizada" : "Sección creada");
    await recargarAdmin();
  } catch (err) {
    aviso(mensajeError(err), true);
  } finally {
    btn.disabled = false;
  }
}

async function alternarSeccion(id, activo) {
  const s = estado.secciones.find((x) => x.id === id);
  try {
    await rpc("cj_guardar_seccion", { p_id: s.id, p_nombre: s.nombre, p_descripcion: s.descripcion, p_orden: s.orden, p_activo: activo });
    aviso(activo ? "Sección visible" : "Sección oculta");
  } catch (err) {
    aviso(mensajeError(err), true);
  }
  await recargarAdmin();
}

async function borrarSeccion(id) {
  const s = estado.secciones.find((x) => x.id === id);
  const total = estado.platillos.filter((p) => p.seccion_id === id).length;
  const extra = total ? `\n\nTambién se eliminarán sus ${total} platillo(s).` : "";
  if (!confirm(`¿Eliminar la sección “${s.nombre}”?${extra}`)) return;
  try {
    await rpc("cj_eliminar_seccion", { p_id: id });
    aviso("Sección eliminada");
    await recargarAdmin();
  } catch (err) {
    aviso(mensajeError(err), true);
  }
}

// ---------- 11. ADMINISTRACIÓN: CAMBIAR PIN ----------
async function cambiarPin(e) {
  e.preventDefault();
  const nuevo = $("#pin-nuevo").value.trim();
  if (nuevo !== $("#pin-confirma").value.trim()) return aviso("Los PIN no coinciden", true);
  try {
    await rpc("cj_cambiar_pin", { p_nuevo: nuevo });
    estado.pin = nuevo;
    e.target.reset();
    aviso("PIN actualizado");
  } catch (err) {
    aviso(mensajeError(err), true);
  }
}

// ---------- 12. CAPAS (MODAL / CAJONES) ----------
// Abre una ventana y bloquea el scroll del fondo (importante en celulares)
function abrirCapa(selector) {
  $(selector).classList.remove("oculto");
  document.body.classList.add("sin-scroll");
}

function cerrarCapas() {
  document.querySelectorAll(".modal-fondo, .cajon-fondo").forEach((c) => c.classList.add("oculto"));
  document.body.classList.remove("sin-scroll");
}

// ---------- 13. EVENTOS ----------
function conectarEventos() {
  // Menú
  $("#buscador").addEventListener("input", (e) => { estado.busqueda = e.target.value; renderMenu(); });
  $("#contenedor-menu").addEventListener("click", (e) => {
    const t = e.target.closest("[data-platillo]");
    if (t) abrirDetalle(t.dataset.platillo);
  });
  $("#nav-secciones").addEventListener("click", (e) => {
    const c = e.target.closest("[data-ir]");
    if (c) document.getElementById("sec-" + c.dataset.ir)?.scrollIntoView({ behavior: "smooth" });
  });

  // Navegación
  $("#btn-ir-admin").addEventListener("click", () => irA("#admin"));
  $("#btn-volver-menu-1").addEventListener("click", () => irA("#"));
  $("#btn-ver-menu").addEventListener("click", () => irA("#"));
  $("#btn-salir").addEventListener("click", cerrarSesion);
  window.addEventListener("hashchange", enrutar);

  // Acceso
  $("#form-login").addEventListener("submit", iniciarSesion);

  // Pestañas
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("activa", t === tab));
    document.querySelectorAll(".tab-contenido").forEach((c) => c.classList.toggle("oculto", c.id !== "tab-" + tab.dataset.tab));
  }));

  // Platillos
  $("#filtro-seccion").addEventListener("change", renderListaPlatillos);
  $("#btn-nuevo-platillo").addEventListener("click", () => abrirFormPlatillo());
  $("#form-platillo").addEventListener("submit", guardarPlatillo);
  $("#lista-platillos").addEventListener("click", (e) => {
    const ed = e.target.closest("[data-editar-platillo]");
    const bo = e.target.closest("[data-borrar-platillo]");
    if (ed) abrirFormPlatillo(ed.dataset.editarPlatillo);
    if (bo) borrarPlatillo(bo.dataset.borrarPlatillo);
  });
  $("#lista-platillos").addEventListener("change", (e) => {
    if (e.target.dataset.togglePlatillo) alternarPlatillo(e.target.dataset.togglePlatillo, e.target.checked);
  });

  // Foto
  $("#p-archivo").addEventListener("change", async (e) => {
    const archivo = e.target.files[0];
    if (!archivo) return;
    try {
      ponerFoto(await comprimirImagen(archivo));
      $("#p-foto-url").value = "";
    } catch (err) {
      aviso(err.message, true);
    }
    e.target.value = "";
  });
  $("#p-foto-url").addEventListener("input", (e) => ponerFoto(e.target.value.trim()));
  $("#p-quitar-foto").addEventListener("click", () => { ponerFoto(""); $("#p-foto-url").value = ""; });

  // Secciones
  $("#btn-nueva-seccion").addEventListener("click", () => abrirFormSeccion());
  $("#form-seccion").addEventListener("submit", guardarSeccion);
  $("#lista-secciones").addEventListener("click", (e) => {
    const ed = e.target.closest("[data-editar-seccion]");
    const bo = e.target.closest("[data-borrar-seccion]");
    if (ed) abrirFormSeccion(ed.dataset.editarSeccion);
    if (bo) borrarSeccion(bo.dataset.borrarSeccion);
  });
  $("#lista-secciones").addEventListener("change", (e) => {
    if (e.target.dataset.toggleSeccion) alternarSeccion(e.target.dataset.toggleSeccion, e.target.checked);
  });

  // Ajustes
  $("#form-pin").addEventListener("submit", cambiarPin);

  // Cerrar capas: botón ×, clic fuera o tecla Esc
  document.querySelectorAll(".modal-fondo, .cajon-fondo").forEach((capa) => {
    capa.addEventListener("click", (e) => {
      if (e.target === capa || e.target.closest("[data-cerrar]")) cerrarCapas();
    });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarCapas(); });
}

// ---------- 14. INICIO ----------
async function iniciar() {
  document.title = `Menú · ${CONFIG.nombreRestaurante}`;
  $("#nombre-restaurante").textContent = CONFIG.nombreRestaurante;
  $("#lema-restaurante").textContent = CONFIG.lema;
  conectarEventos();

  try {
    await cargarDatos();
  } catch (err) {
    $("#contenedor-menu").innerHTML = `<div class="vacio">No se pudo cargar el menú. Revisa tu conexión.</div>`;
    console.error(err);
  }
  enrutar();

  // Actualización automática del menú del cliente (sin recargar la página)
  setInterval(async () => {
    if (location.hash === "#admin" || document.hidden) return;
    try {
      const antes = JSON.stringify([estado.secciones, estado.platillos]);
      await cargarDatos();
      // Solo vuelve a dibujar si algo cambió en el panel de administración
      if (antes !== JSON.stringify([estado.secciones, estado.platillos])) renderMenu();
    } catch (_) { /* se reintenta en el siguiente ciclo */ }
  }, CONFIG.intervaloRefresco);
}

iniciar();