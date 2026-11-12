// Ink in water: a small GPU fluid simulation (Jos Stam's "stable fluids") drawn in WebGL 2.
// Moving the pointer pushes the water and drops black ink into it. The loop runs only while
// something moves and the section is on screen.

const VERTEX = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vUv, vL, vR, vT, vB;
uniform vec2 texelSize;
void main() {
	vUv = aPosition * 0.5 + 0.5;
	vL = vUv - vec2(texelSize.x, 0.0);
	vR = vUv + vec2(texelSize.x, 0.0);
	vT = vUv + vec2(0.0, texelSize.y);
	vB = vUv - vec2(0.0, texelSize.y);
	gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv, vL, vR, vT, vB;
out vec4 outColor;
`;

const SHADERS = {
	splat: `uniform sampler2D uTarget; uniform float aspect, radius; uniform vec3 color; uniform vec2 point;
	void main() { vec2 p = vUv - point; p.x *= aspect; outColor = vec4(texture(uTarget, vUv).xyz + exp(-dot(p, p) / radius) * color, 1.0); }`,
	advect: `uniform sampler2D uVelocity, uSource; uniform vec2 texelSize; uniform float dt, dissipation;
	void main() { vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * texelSize; outColor = texture(uSource, coord) / (1.0 + dissipation * dt); }`,
	divergence: `uniform sampler2D uVelocity;
	void main() {
		float L = texture(uVelocity, vL).x, R = texture(uVelocity, vR).x, T = texture(uVelocity, vT).y, B = texture(uVelocity, vB).y;
		vec2 C = texture(uVelocity, vUv).xy;
		if (vL.x < 0.0) L = -C.x; if (vR.x > 1.0) R = -C.x; if (vT.y > 1.0) T = -C.y; if (vB.y < 0.0) B = -C.y;
		outColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
	}`,
	curl: `uniform sampler2D uVelocity;
	void main() { outColor = vec4(0.5 * (texture(uVelocity, vR).y - texture(uVelocity, vL).y - texture(uVelocity, vT).x + texture(uVelocity, vB).x), 0.0, 0.0, 1.0); }`,
	vorticity: `uniform sampler2D uVelocity, uCurl; uniform float curl, dt;
	void main() {
		float L = texture(uCurl, vL).x, R = texture(uCurl, vR).x, T = texture(uCurl, vT).x, B = texture(uCurl, vB).x, C = texture(uCurl, vUv).x;
		vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
		force = force / (length(force) + 0.0001) * curl * C;
		force.y *= -1.0;
		outColor = vec4(texture(uVelocity, vUv).xy + force * dt, 0.0, 1.0);
	}`,
	pressure: `uniform sampler2D uPressure, uDivergence;
	void main() {
		float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x, T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
		outColor = vec4((L + R + B + T - texture(uDivergence, vUv).x) * 0.25, 0.0, 0.0, 1.0);
	}`,
	gradient: `uniform sampler2D uPressure, uVelocity;
	void main() {
		float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x, T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
		outColor = vec4(texture(uVelocity, vUv).xy - vec2(R - L, T - B), 0.0, 1.0);
	}`,
	scale: `uniform sampler2D uTexture; uniform float value;
	void main() { outColor = value * texture(uTexture, vUv); }`,
	display: `uniform sampler2D uTexture; uniform vec3 paper, ink;
	void main() { float d = 1.0 - exp(-texture(uTexture, vUv).r * 2.4); outColor = vec4(mix(paper, ink, clamp(d, 0.0, 1.0)), 1.0); }`,
};

type Program = { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> };
type Target = { texture: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number };
type Double = { read: Target; write: Target; swap: () => void };

const PAPER = [244 / 255, 241 / 255, 234 / 255];
const INK = [11 / 255, 11 / 255, 15 / 255];

export function inkWater(section: HTMLElement, canvas: HTMLCanvasElement, reduce: boolean) {
	if (reduce) return;
	const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
	if (!gl || !gl.getExtension('EXT_color_buffer_float')) return;

	const compile = (type: number, source: string) => {
		const shader = gl.createShader(type)!;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		return shader;
	};
	const vertex = compile(gl.VERTEX_SHADER, VERTEX);
	const make = (body: string): Program => {
		const program = gl.createProgram()!;
		gl.attachShader(program, vertex);
		gl.attachShader(program, compile(gl.FRAGMENT_SHADER, HEAD + body));
		gl.bindAttribLocation(program, 0, 'aPosition');
		gl.linkProgram(program);
		const uniforms: Program['uniforms'] = {};
		const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
		for (let i = 0; i < count; i++) {
			const name = gl.getActiveUniform(program, i)!.name;
			uniforms[name] = gl.getUniformLocation(program, name);
		}
		return { program, uniforms };
	};
	const p = Object.fromEntries(Object.entries(SHADERS).map(([k, v]) => [k, make(v)])) as Record<keyof typeof SHADERS, Program>;
	if (!gl.getProgramParameter(p.display.program, gl.LINK_STATUS)) return;

	gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
	gl.enableVertexAttribArray(0);

	const target = (w: number, h: number, format: number, internal: number): Target => {
		const texture = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.HALF_FLOAT, null);
		const fbo = gl.createFramebuffer()!;
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
		gl.clearColor(0, 0, 0, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);
		return { texture, fbo, w, h };
	};
	const double = (w: number, h: number, format: number, internal: number): Double => {
		const d = { read: target(w, h, format, internal), write: target(w, h, format, internal), swap: () => ([d.read, d.write] = [d.write, d.read]) };
		return d;
	};

	const small = matchMedia('(max-width: 760px)').matches;
	let velocity: Double, dye: Double, pressure: Double, divergence: Target, curl: Target;
	const size = (res: number) => {
		const aspect = canvas.width / canvas.height;
		return aspect > 1 ? [Math.round(res * aspect), res] : [res, Math.round(res / aspect)];
	};
	const allocate = () => {
		const [sw, sh] = size(small ? 96 : 128);
		const [dw, dh] = size(small ? 384 : 768);
		velocity = double(sw, sh, gl.RG, gl.RG16F);
		pressure = double(sw, sh, gl.RED, gl.R16F);
		divergence = target(sw, sh, gl.RED, gl.R16F);
		curl = target(sw, sh, gl.RED, gl.R16F);
		dye = double(dw, dh, gl.RED, gl.R16F);
	};

	const resize = () => {
		const dpr = Math.min(1.5, devicePixelRatio || 1);
		const w = Math.round(canvas.clientWidth * dpr);
		const h = Math.round(canvas.clientHeight * dpr);
		if (w === canvas.width && h === canvas.height && velocity) return;
		canvas.width = w;
		canvas.height = h;
		allocate();
		render();
	};

	let unit = 0;
	const bind = (prog: Program) => {
		gl.useProgram(prog.program);
		unit = 0;
		return prog;
	};
	const tex = (prog: Program, name: string, t: Target) => {
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, t.texture);
		gl.uniform1i(prog.uniforms[name], unit++);
	};
	const draw = (t: Target | null) => {
		gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
		gl.viewport(0, 0, t ? t.w : canvas.width, t ? t.h : canvas.height);
		gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
	};
	const texel = (prog: Program, t: Target) => gl.uniform2f(prog.uniforms.texelSize, 1 / t.w, 1 / t.h);

	const splat = (x: number, y: number, dx: number, dy: number, amount: number, radius: number) => {
		const aspect = canvas.width / canvas.height;
		let s = bind(p.splat);
		tex(s, 'uTarget', velocity.read);
		gl.uniform1f(s.uniforms.aspect, aspect);
		gl.uniform2f(s.uniforms.point, x, y);
		gl.uniform3f(s.uniforms.color, dx, dy, 0);
		gl.uniform1f(s.uniforms.radius, radius);
		draw(velocity.write);
		velocity.swap();
		s = bind(p.splat);
		tex(s, 'uTarget', dye.read);
		gl.uniform1f(s.uniforms.aspect, aspect);
		gl.uniform2f(s.uniforms.point, x, y);
		gl.uniform3f(s.uniforms.color, amount, 0, 0);
		gl.uniform1f(s.uniforms.radius, radius);
		draw(dye.write);
		dye.swap();
	};

	const step = (dt: number) => {
		let s = bind(p.curl);
		texel(s, velocity.read);
		tex(s, 'uVelocity', velocity.read);
		draw(curl);

		s = bind(p.vorticity);
		texel(s, velocity.read);
		tex(s, 'uVelocity', velocity.read);
		tex(s, 'uCurl', curl);
		gl.uniform1f(s.uniforms.curl, 32);
		gl.uniform1f(s.uniforms.dt, dt);
		draw(velocity.write);
		velocity.swap();

		s = bind(p.divergence);
		texel(s, velocity.read);
		tex(s, 'uVelocity', velocity.read);
		draw(divergence);

		s = bind(p.scale);
		tex(s, 'uTexture', pressure.read);
		gl.uniform1f(s.uniforms.value, 0.8);
		draw(pressure.write);
		pressure.swap();

		s = bind(p.pressure);
		texel(s, velocity.read);
		tex(s, 'uDivergence', divergence);
		for (let i = 0; i < 20; i++) {
			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(gl.TEXTURE_2D, pressure.read.texture);
			gl.uniform1i(s.uniforms.uPressure, 1);
			draw(pressure.write);
			pressure.swap();
		}

		s = bind(p.gradient);
		texel(s, velocity.read);
		tex(s, 'uPressure', pressure.read);
		tex(s, 'uVelocity', velocity.read);
		draw(velocity.write);
		velocity.swap();

		s = bind(p.advect);
		texel(s, velocity.read);
		tex(s, 'uVelocity', velocity.read);
		tex(s, 'uSource', velocity.read);
		gl.uniform1f(s.uniforms.dt, dt);
		gl.uniform1f(s.uniforms.dissipation, 0.25);
		draw(velocity.write);
		velocity.swap();

		s = bind(p.advect);
		texel(s, velocity.read);
		tex(s, 'uVelocity', velocity.read);
		tex(s, 'uSource', dye.read);
		gl.uniform1f(s.uniforms.dt, dt);
		gl.uniform1f(s.uniforms.dissipation, 0.45);
		draw(dye.write);
		dye.swap();
	};

	const render = () => {
		const s = bind(p.display);
		tex(s, 'uTexture', dye.read);
		gl.uniform3f(s.uniforms.paper, PAPER[0], PAPER[1], PAPER[2]);
		gl.uniform3f(s.uniforms.ink, INK[0], INK[1], INK[2]);
		draw(null);
	};

	let raf = 0;
	let last = 0;
	let until = 0;
	let visible = false;
	const frame = (now: number) => {
		raf = 0;
		const dt = Math.min((now - (last || now)) / 1000, 1 / 30);
		last = now;
		step(dt || 1 / 60);
		render();
		if (visible && now < until) raf = requestAnimationFrame(frame);
		else last = 0;
	};
	const wake = (ms: number) => {
		until = Math.max(until, performance.now() + ms);
		if (visible && !raf) raf = requestAnimationFrame(frame);
	};

	let px = -1;
	let py = -1;
	section.addEventListener('pointermove', (e) => {
		const box = canvas.getBoundingClientRect();
		const x = (e.clientX - box.left) / box.width;
		const y = 1 - (e.clientY - box.top) / box.height;
		if (px >= 0) {
			const dx = x - px;
			const dy = y - py;
			if (dx || dy) splat(x, y, dx * 6000, dy * 6000, 0.4, 0.0003);
		}
		px = x;
		py = y;
		wake(7000);
	});
	section.addEventListener('pointerleave', () => (px = -1));

	// The first time the section shows, a drop falls into the water.
	let poured = false;
	const pour = () => {
		const x = 0.72;
		for (let i = 0; i < 6; i++) splat(x + (Math.random() - 0.5) * 0.01, 0.9 - i * 0.012, (Math.random() - 0.5) * 60, -380, 0.9, 0.0006);
		wake(8000);
	};

	resize();
	addEventListener('resize', resize);
	new IntersectionObserver(([entry]) => {
		visible = entry.isIntersecting;
		if (!visible) return;
		if (!poured) {
			poured = true;
			pour();
		} else if (performance.now() < until && !raf) raf = requestAnimationFrame(frame);
	}).observe(section);
}
