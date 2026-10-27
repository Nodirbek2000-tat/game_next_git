"use client";

import { Canvas, useFrame, type ThreeElements } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const WATER_VERT = /* glsl */ `
  uniform float uTime;
  varying float vH;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    float d = length(p.xy);
    float h = sin(d * 3.2 - uTime * 1.8) * 0.06 * exp(-d * 0.45)
            + sin(p.x * 1.6 + uTime * 0.9) * 0.025 + sin(p.y * 1.9 - uTime * 0.7) * 0.025;
    p.z += h;
    vH = h;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const WATER_FRAG = /* glsl */ `
  uniform vec3 uA; uniform vec3 uB;
  varying float vH; varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    vec3 col = mix(uA, uB, smoothstep(0.0, 1.0, r) * 0.7 + vH * 3.0);
    col += smoothstep(0.045, 0.09, vH) * 0.35;
    float alpha = (1.0 - smoothstep(0.55, 1.0, r)) * 0.92;
    gl_FragColor = vec4(col, alpha);
  }
`;

type Palette = { a: string; b: string };
const PALETTES: Record<"dark" | "light", Palette> = {
  dark: { a: "#22d3ee", b: "#6d28d9" },
  light: { a: "#38bdf8", b: "#8b5cf6" },
};

function Water({ palette }: { palette: Palette }) {
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uA: { value: new THREE.Color(palette.a) }, uB: { value: new THREE.Color(palette.b) } }),
    [palette],
  );
  const mat = useRef<THREE.ShaderMaterial>(null);
  useFrame((_, dt) => {
    if (mat.current) mat.current.uniforms.uTime.value += dt;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[9, 9, 72, 72]} />
      <shaderMaterial ref={mat} uniforms={uniforms} vertexShader={WATER_VERT} fragmentShader={WATER_FRAG} transparent depthWrite={false} />
    </mesh>
  );
}

function Ripples() {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    refs.current.forEach((m, i) => {
      if (!m) return;
      const t = (clock.elapsedTime * 0.45 + i / 3) % 1;
      m.scale.setScalar(0.3 + t * 3.2);
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.7;
    });
  });
  return (
    <>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(el) => { refs.current[i] = el; }} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.97, 1, 64]} />
          <meshBasicMaterial color="#e0f2fe" transparent depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

function Bobber(props: ThreeElements["group"]) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (!g.current) return;
    g.current.position.y = 0.18 + Math.sin(t * 1.6) * 0.07 - Math.max(0, Math.sin(t * 0.55 - 1)) * 0.12;
    g.current.rotation.z = Math.sin(t * 1.1) * 0.1;
    g.current.rotation.x = Math.cos(t * 0.9) * 0.08;
  });
  return (
    <group ref={g} {...props}>
      <mesh position={[0, 0.2, 0]}>
        <sphereGeometry args={[0.55, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#ff3d62" roughness={0.3} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0.2, 0]} rotation={[Math.PI, 0, 0]}>
        <sphereGeometry args={[0.55, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#f5f3ff" roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <torusGeometry args={[0.55, 0.025, 8, 48]} />
        <meshStandardMaterial color="#19133a" />
      </mesh>
      <mesh position={[0, 1.05, 0]}>
        <cylinderGeometry args={[0.045, 0.06, 1.0, 12]} />
        <meshStandardMaterial color="#fbbf24" roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.58, 0]}>
        <sphereGeometry args={[0.08, 16, 12]} />
        <meshStandardMaterial color="#fb7185" emissive="#fb7185" emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0, -0.7, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.9, 6]} />
        <meshBasicMaterial color="#c4b5fd" transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

function Rig() {
  // Gentle pointer parallax on the camera.
  useFrame(({ camera, pointer }, dt) => {
    const k = 1 - Math.exp(-dt * 3);
    camera.position.x += (pointer.x * 0.7 - camera.position.x) * k;
    camera.position.y += (2.6 + pointer.y * 0.35 - camera.position.y) * k;
    camera.lookAt(0, 0.55, 0);
  });
  return null;
}

export default function HeroCanvas({ onReady }: { onReady?: () => void }) {
  const [dark, setDark] = useState(true);
  const [visible, setVisible] = useState(true);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.dataset.theme !== "light");
    read();
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    if (wrap.current) io.observe(wrap.current);
    return () => {
      mo.disconnect();
      io.disconnect();
    };
  }, []);

  const palette = PALETTES[dark ? "dark" : "light"];
  return (
    <div ref={wrap} className="size-full">
      <Canvas
        dpr={[1, 1.5]}
        frameloop={visible ? "always" : "never"}
        camera={{ position: [0, 2.6, 5.4], fov: 38 }}
        gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          requestAnimationFrame(() => onReady?.());
        }}
      >
        <ambientLight intensity={1.1} />
        <directionalLight position={[3, 5, 3]} intensity={2.2} />
        <Water palette={palette} />
        <Ripples />
        <Bobber />
        <Rig />
      </Canvas>
    </div>
  );
}
