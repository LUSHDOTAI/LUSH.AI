        class CryptoPRNG {
            constructor() { this.buffer = new Uint32Array(1); }
            next() { window.crypto.getRandomValues(this.buffer); return this.buffer[0] / (0xFFFFFFFF + 1); }
        }

        class LushTree {
            constructor(canvasId, originId) {
                this.canvas = document.getElementById(canvasId);
                this.ctx = this.canvas.getContext('2d');
                this.originElement = document.getElementById(originId);
                this.prng = new CryptoPRNG();
                this.cssWidth = 0; this.cssHeight = 0;
                this.rootY = 0; 
                this.dotMetrics = null; // Store calculated dot position
                this.config = {
                    BRANCH_MAX_DEPTH: 10,
                    LEAF_DENSITY: 0.8,
                    BLOSSOM_DENSITY: 0.6,
                    CHERRY_DENSITY: 0.05,
                    LEAF_AUTUMN_COLORS: ['rgba(255, 165, 0, 1)', 'rgba(210, 105, 30, 1)', 'rgba(139, 69, 19, 1)'],
                    LEAF_COLORS: [ '60, 179, 113', '46, 139, 87', '34, 139, 34', '0, 128, 0', '85, 107, 47' ],
                    CHERRY_COLORS: [ 'rgba(178, 34, 34, 1)', 'rgba(139, 0, 0, 1)', 'rgba(180, 20, 20, 1)' ],
                    BLOSSOM_COLORS: ['#FF69B4', '#FFB6C1', '#DB7093', '#C71585'],
                    LEAF_SWAY_MAGNITUDE: 0.45,
                    lake: { heightPercent: 0.4, color: 'rgba(3, 10, 22, 0.5)', reflectionOpacity: 0.2 },
                    wind: { x: 0.15, y: 0.05 }
                };
                this.state = { branches: [], leaves: [], blossoms: [], cherries: [], ripples: [], activeTimeouts: new Set(), isAnimating: false, animationFrameId: null };
                window.addEventListener('resize', () => this.handleResize());
                this.init();
            }

            init() {
                let dpr = window.devicePixelRatio || 1;
                if (dpr < 1) {
                    console.warn(`Warning: Incorrect devicePixelRatio detected (${dpr}). Resetting to 1.0.`);
                    dpr = 1;
                }
                const rect = this.canvas.getBoundingClientRect();
                this.cssWidth = rect.width; this.cssHeight = rect.height;
                this.canvas.width = this.cssWidth * dpr;
                this.canvas.height = this.cssHeight * dpr;
                this.ctx.scale(dpr, dpr);
                this.ctx.lineCap = 'round'; this.ctx.lineJoin = 'round';

                // Calculate where the invisible dot is, so we can draw a visible one on top
                const originRect = this.originElement.getBoundingClientRect();
                this.dotMetrics = {
                    x: (originRect.left - rect.left) + originRect.width / 2,
                    y: (originRect.top - rect.top) + originRect.height / 2,
                    radius: originRect.width / 2
                };

                this.start();
            }
            
            start() { if (this.state.isAnimating) return; this.state.isAnimating = true; this.runFullCycleLoop(); this.animate(); }
            stop() { this.state.isAnimating = false; if (this.state.animationFrameId) cancelAnimationFrame(this.state.animationFrameId); this.state.activeTimeouts.forEach(clearTimeout); this.state.activeTimeouts.clear(); }
            animate() { if (!this.state.isAnimating) return; this.ctx.clearRect(0, 0, this.cssWidth, this.cssHeight); this.draw(); this.update(); this.state.animationFrameId = requestAnimationFrame(() => this.animate()); }
            _setTimeout(callback, delay) { const id = setTimeout(() => { this.state.activeTimeouts.delete(id); if (this.state.isAnimating) callback(); }, delay); this.state.activeTimeouts.add(id); return id; }
            
            async runFullCycleLoop() {
                const sleep = (ms) => new Promise(resolve => this._setTimeout(resolve, ms));
                while(this.state.isAnimating) {
                    this.reset();
                    await this.growTree(); if (!this.state.isAnimating) break;
                    await this.growLeaves(); if (!this.state.isAnimating) break;
                    await this.growBlossoms(); if (!this.state.isAnimating) break;
                    await sleep(4000);
                    this.dropIndividually(this.state.blossoms, 18500); await this.waitForFall('blossoms'); if (!this.state.isAnimating) break;
                    this.growCherries(); await sleep(3000 + this.prng.next() * 500); if (!this.state.isAnimating) break;
                    this.dropIndividually(this.state.cherries, 25000); await this.waitForFall('cherries'); if (!this.state.isAnimating) break;
                    this.changeLeafColors(); await sleep(6000 + this.prng.next() * 1000); if (!this.state.isAnimating) break;
                    this.dropIndividually(this.state.leaves, 24000); await this.waitForFall('leaves'); if (!this.state.isAnimating) break;
                }
            }
            
            // --- DRAWING LOGIC WITH SWAY & DEPTH ---

            getWindForce(time, x) {
                const spatialPhase = x * 0.001; 
                return Math.sin(time / 4000 + spatialPhase) * 0.45 + 
                       Math.sin(time / 2500 + spatialPhase + 2) * 0.2 + 
                       Math.sin(time / 500) * 0.05;
            }

            getWindSway(x, y) {
                const time = Date.now();
                const localGust = this.getWindForce(time, x);
                const dist = Math.abs(this.rootY - y);
                const amplitude = Math.pow(dist, 1.2) * 0.00015; 
                return localGust * amplitude * 100;
            }

            draw() { this.drawScene(false); this.drawLake(); this.drawFallingParticles(); }
            
            drawScene(isReflection) {
                const ctx = this.ctx;
                if (isReflection) { ctx.save(); const lakeSurfaceY = this.cssHeight * (1 - this.config.lake.heightPercent); const reflectionScale = 0.7; ctx.translate(0, (1 + reflectionScale) * lakeSurfaceY); ctx.scale(1, -reflectionScale); ctx.globalAlpha = this.config.lake.reflectionOpacity; }
                
                const sortedBranches = [...this.state.branches].sort((a, b) => a.z - b.z);

                sortedBranches.forEach(branch => {
                    const age = Date.now() - branch.spawnTime, progress = Math.min(1, age / 600);
                    const thickness = (this.config.BRANCH_MAX_DEPTH - branch.depth) * 1.5 * progress + 0.5;
                    ctx.lineWidth = Math.max(0.2, thickness);
                    
                    const zFactor = (branch.z + 1) / 2;
                    const depthRatio = branch.depth / this.config.BRANCH_MAX_DEPTH;
                    
                    const r = Math.floor((60 + depthRatio * 40) * (0.6 + 0.4 * zFactor));
                    const g = Math.floor((40 + depthRatio * 50) * (0.6 + 0.4 * zFactor));
                    const b = Math.floor((30 + depthRatio * 20) * (0.6 + 0.4 * zFactor));
                    const alpha = Math.max(0.1, 1 - (branch.depth / (this.config.BRANCH_MAX_DEPTH + 4)));
                    
                    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                    
                    const startSway = this.getWindSway(branch.startX, branch.startY);
                    const endSway = this.getWindSway(branch.endX, branch.endY);
                    const controlSway = this.getWindSway(branch.controlX, branch.controlY);

                    ctx.beginPath(); 
                    ctx.moveTo(branch.startX + startSway, branch.startY);
                    
                    const currentX = branch.startX + (branch.endX - branch.startX) * progress;
                    const currentY = branch.startY + (branch.endY - branch.startY) * progress;
                    const currentControlX = branch.startX + (branch.controlX - branch.startX) * progress;
                    const currentControlY = branch.startY + (branch.controlY - branch.startY) * progress;
                    
                    const currentEndSway = startSway + (endSway - startSway) * progress;
                    const currentCtrlSway = startSway + (controlSway - startSway) * progress;

                    ctx.quadraticCurveTo(currentControlX + currentCtrlSway, currentControlY, currentX + currentEndSway, currentY); 
                    ctx.stroke();
                });
                
                const sf = Math.min(this.cssWidth, this.cssHeight) / 1000;
                this.state.leaves.filter(p => !p.falling && !p.floating).forEach(p => this.drawLeaf(p, sf, true));
                this.state.blossoms.filter(p => !p.falling && !p.floating).forEach(p => this.drawBlossom(p, sf, true));
                this.state.cherries.filter(p => !p.falling && !p.floating).forEach(p => this.drawCherry(p, sf, true));
                
                // EDITED: Manually draw the dot on the canvas so it sits ON TOP of the tree.
                // We do not draw this in the reflection pass.
                if (!isReflection && this.dotMetrics) {
                    ctx.fillStyle = 'white';
                    ctx.beginPath();
                    ctx.arc(this.dotMetrics.x, this.dotMetrics.y, this.dotMetrics.radius, 0, Math.PI * 2);
                    ctx.fill();
                }

                if (isReflection) ctx.restore();
            }

            drawLake() { const lakeSurfaceY = this.cssHeight * (1 - this.config.lake.heightPercent); this.drawScene(true); this.ctx.fillStyle = this.config.lake.color; this.ctx.fillRect(0, lakeSurfaceY, this.cssWidth, this.cssHeight * this.config.lake.heightPercent); const sf = Math.min(this.cssWidth, this.cssHeight) / 1000; this.state.leaves.filter(p => p.floating).forEach(p => this.drawLeaf(p, sf, false)); this.state.blossoms.filter(p => p.floating).forEach(p => this.drawBlossom(p, sf, false)); this.state.cherries.filter(p => p.floating).forEach(p => this.drawCherry(p, sf, false)); this.drawRipples(); }
            
            drawFallingParticles() { const sf = Math.min(this.cssWidth, this.cssHeight) / 1000; const lakeSurfaceY = this.cssHeight * (1 - this.config.lake.heightPercent); this.state.leaves.filter(p => p.falling && !p.floating && p.y < lakeSurfaceY).forEach(p => this.drawLeaf(p, sf, false)); this.state.blossoms.filter(p => p.falling && !p.floating && p.y < lakeSurfaceY).forEach(p => this.drawBlossom(p, sf, false)); this.state.cherries.filter(p => p.falling && !p.floating && p.y < lakeSurfaceY).forEach(p => this.drawCherry(p, sf, false)); }
            
            drawRipples() { this.state.ripples.forEach(ripple => { const progress = (Date.now() - ripple.startTime) / ripple.duration; const currentRadius = ripple.maxWidth * progress; const opacity = 1 - progress; this.ctx.strokeStyle = `rgba(200, 220, 255, ${opacity * 0.3})`; this.ctx.lineWidth = 2 * (1 - progress); this.ctx.beginPath(); this.ctx.ellipse(ripple.x, ripple.y, currentRadius, currentRadius * 0.4, 0, 0, Math.PI * 2); this.ctx.stroke(); }); }
            
            // --- NEW SHAPE DRAWING FUNCTIONS ---

            drawLeaf(p, sf, attached) {
                // Sway matches branch logic exactly
                const sway = attached ? this.getWindSway(p.anchorX, p.anchorY) : 0;
                const x = p.x + sway;
                const y = p.y;
                
                this.ctx.save();
                this.ctx.translate(x, y);
                this.ctx.rotate(p.rotation || 0);
                this.ctx.scale(p.scale, p.scale);
                
                this.ctx.fillStyle = p.color;
                this.ctx.globalAlpha = p.opacity;
                
                const size = 2.5 * sf;
                this.ctx.beginPath();
                this.ctx.moveTo(0, -size);
                this.ctx.bezierCurveTo(size, -size, size, size, 0, size * 1.5); 
                this.ctx.bezierCurveTo(-size, size, -size, -size, 0, -size);    
                this.ctx.fill();
                
                this.ctx.globalAlpha = 1;
                this.ctx.restore();
            }

            drawBlossom(p, sf, attached) {
                const sway = attached ? this.getWindSway(p.anchorX, p.anchorY) : 0;
                const x = p.x + sway;
                const y = p.y;
                
                this.ctx.save();
                this.ctx.translate(x, y);
                this.ctx.rotate(p.rotation || 0);
                this.ctx.scale(p.scale, p.scale);

                this.ctx.fillStyle = this.config.BLOSSOM_COLORS[p.colorIndex];
                this.ctx.globalAlpha = p.opacity;
                
                // SIMPLIFIED: Replaced detailed 5-petal notched flower with a simple organic circle
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 1.8 * sf, 0, Math.PI * 2);
                this.ctx.fill();
                
                this.ctx.globalAlpha = 1;
                this.ctx.restore();
            }

            drawCherry(p, sf, attached) {
                const sway = attached ? this.getWindSway(p.anchorX, p.anchorY) : 0;
                const x = p.x + sway;
                const y = p.y;

                if (attached) {
                    this.ctx.strokeStyle = 'rgba(60, 40, 20, 0.8)';
                    this.ctx.lineWidth = 0.5 * sf;
                    this.ctx.beginPath();
                    this.ctx.moveTo(x, y); 
                    this.ctx.lineTo(p.anchorX + sway, p.anchorY - 5 * sf);
                    this.ctx.stroke();
                }

                this.ctx.save();
                this.ctx.translate(x, y);
                this.ctx.rotate(p.rotation || 0);
                this.ctx.scale(p.scale, p.scale);

                const baseColor = this.config.CHERRY_COLORS[p.colorIndex] || 'rgba(220, 20, 60, 1)';
                this.ctx.fillStyle = baseColor.replace(', 1)', `, ${p.opacity})`);
                
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 2 * sf, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                this.ctx.beginPath();
                this.ctx.ellipse(-0.6 * sf, -0.6 * sf, 0.6 * sf, 0.3 * sf, Math.PI / 4, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.restore();
            }

            // --- GENERATION & UPDATE ---

            async growTree() { 
                const originRect = this.originElement.getBoundingClientRect(); 
                const startX = (originRect.left + originRect.right) / 2;
                const startY = originRect.top;
                this.rootY = startY; 
                const initialLength = (this.cssHeight / 9) * (0.9 + this.prng.next() * 0.2); 
                await this.createBranch(startX, startY, -Math.PI / 2, initialLength, 0, 0); 
            }
            
            async createBranch(x, y, angle, length, depth, z) {
                if (depth >= this.config.BRANCH_MAX_DEPTH || length < 2 || !this.state.isAnimating) return; 

                const droop = (depth / this.config.BRANCH_MAX_DEPTH) * 0.15;
                let targetAngle = angle;
                if (angle < Math.PI / 2 && angle > -Math.PI * 1.5) {
                    targetAngle += droop; 
                }

                const endX = x + Math.cos(targetAngle) * length;
                const endY = y + Math.sin(targetAngle) * length;
                const midX = (x + endX) / 2, midY = (y + endY) / 2;
                const controlX = midX + (this.prng.next() - 0.5) * length * 0.6; 
                const controlY = midY + (this.prng.next() - 0.5) * length * 0.6;
                
                this.state.branches.push({ startX: x, startY: y, controlX, controlY, endX, endY, depth, z, spawnTime: Date.now() });
                
                const branchesToCreate = this.prng.next() > 0.4 ? 2 : 3; 
                const childPromises = [];
                for (let i = 0; i < branchesToCreate; i++) { 
                    const angleVariation = (Math.PI / 3) * (this.prng.next() * 2 - 1); 
                    const newAngle = angle + angleVariation; 
                    const newLength = length * (0.65 + this.prng.next() * 0.2); 
                    const newZ = z + (this.prng.next() - 0.5) * 0.5;
                    const clampedZ = Math.max(-1, Math.min(1, newZ));
                    childPromises.push(this.createBranch(endX, endY, newAngle, newLength, depth + 1, clampedZ)); 
                }
                await Promise.all(childPromises);
            }
            
            async growLeaves() { 
                const branchesWithPotential = this.state.branches.filter(b => b.depth > 2); 
                branchesWithPotential.forEach(branch => { 
                    if (this.prng.next() < this.config.LEAF_DENSITY) { 
                        const baseColor = this.config.LEAF_COLORS[Math.floor(this.prng.next() * this.config.LEAF_COLORS.length)]; 
                        const finalColor = `rgba(${baseColor}, 1)`; 
                        this.state.leaves.push(this.createParticle(branch.endX, branch.endY, { type: 'leaf', color: finalColor, sway: true, delay: this.bellCurveRandom(3000), z: branch.z })); 
                    } 
                }); 
                await new Promise(resolve => this._setTimeout(resolve, 3000)); 
            }
            
            handleResize() { this.stop(); this._setTimeout(() => this.init(), 100); }
            reset() { this.state.activeTimeouts.forEach(clearTimeout); this.state.activeTimeouts.clear(); Object.keys(this.state).forEach(key => { if (Array.isArray(this.state[key])) this.state[key] = []; }); }
            waitForFall(arrayKey) { return new Promise(resolve => { const check = () => { if (!this.state.isAnimating) { resolve(); return; } if (this.state[arrayKey] && this.state[arrayKey].length === 0) { resolve(); } else { this._setTimeout(check, 100); } }; check(); }); }
            bellCurveRandom(maxDelay) { const u = this.prng.next(), v = this.prng.next(); const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v); const mean = maxDelay / 2, stdDev = maxDelay / 6; const randomTime = mean + z * stdDev; return Math.max(0, Math.min(maxDelay, randomTime)); }
            dropIndividually(particleArray, duration) { particleArray.forEach(p => { const delay = this.bellCurveRandom(duration); this._setTimeout(() => { if (p) p.falling = true; }, delay); }); }
            
            update() { const lakeSurfaceY = this.cssHeight * (1 - this.config.lake.heightPercent); this.updateParticles(this.state.leaves, lakeSurfaceY); this.updateParticles(this.state.blossoms, lakeSurfaceY); this.updateParticles(this.state.cherries, lakeSurfaceY); this.state.leaves = this.state.leaves.filter(p => !p.hasFallen); this.state.blossoms = this.state.blossoms.filter(p => !p.hasFallen); this.state.cherries = this.state.cherries.filter(p => !p.hasFallen); this.updateRipples(); }
            
            createParticle(x, y, overrides = {}) { 
                return { 
                    x, y, anchorX: x, anchorY: y, z: 0, 
                    vx: (this.prng.next() - 0.5) * 0.5, vy: 0, 
                    rotation: this.prng.next() * Math.PI * 2, 
                    rotationSpeed: (this.prng.next() - 0.5) * 0.1, 
                    opacity: 0, falling: false, floating: false, hasFallen: false, 
                    spawnTime: Date.now(), delay: 0, 
                    randomOffset: this.prng.next() * 100, 
                    scale: 0.7 + this.prng.next() * 0.6, 
                    ...overrides 
                }; 
            }
            
            updateParticles(particleArray, lakeSurfaceY) {
                const now = Date.now();
                
                particleArray.forEach(p => {
                    if (p.hasFallen || now < p.spawnTime + p.delay) return;

                    // UPDATED: Use the exact same wind force as the tree sway
                    const localWind = this.getWindForce(now, p.x);
                    
                    if (p.floating) { 
                        p.x += this.config.wind.x + localWind + (p.driftX || 0); 
                        p.y += this.config.wind.y + (p.driftY || 0); 
                        p.rotation += p.rotationSpeed * 0.2; 
                        if (now - p.floatStartTime > p.floatDuration) p.hasFallen = true; 
                        return; 
                    }
                    if (p.falling) {
                        let gravity = 0.05, flutter = 0.1, airResistance = 0.99;
                        switch (p.type) { case 'blossom': gravity = 0.008; flutter = 0.3; airResistance = 0.99; break; case 'leaf': gravity = 0.01; flutter = 0.2; airResistance = 0.985; break; case 'cherry': gravity = 0.04; flutter = 0.01; break; }
                        
                        p.y += p.vy; 
                        // UPDATED: Multiplier increased to 2.0 (was 0.8) so leaves really "whoosh" with the gust
                        p.x += p.vx + (this.config.wind.x + localWind) * 2.0; 
                        p.vy += gravity; 
                        p.vx += (this.prng.next() - 0.5) * flutter; 
                        p.vx *= airResistance;
                        p.rotation += p.rotationSpeed; 
                        
                        const landingY = lakeSurfaceY + (p.z * 15);
                        if (p.y >= landingY) { p.floating = true; p.y = landingY; this.createRipple(p.x, p.y); p.floatStartTime = now; p.floatDuration = 3000 + this.prng.next() * 4000; p.driftX = (this.prng.next() - 0.5) * 0.4; p.driftY = this.prng.next() * 0.15; }
                    } else {
                        p.opacity = Math.min(1, p.opacity + 0.05);
                        if (p.sway) { 
                            // Only small local movement relative to anchor, global sway handles the rest
                            p.x = p.anchorX + Math.sin(now / 1000 + p.randomOffset) * (this.config.LEAF_SWAY_MAGNITUDE * 0.2); 
                            p.y = p.anchorY + Math.cos(now / 800 + p.randomOffset) * (this.config.LEAF_SWAY_MAGNITUDE * 0.2); 
                        }
                        if (p.isChangingColor) { const elapsed = Date.now() - p.colorChangeStartTime, progress = Math.min(1, elapsed / p.colorChangeDuration); const r = p.startColor.r + (p.targetColor.r - p.startColor.r) * progress; const g = p.startColor.g + (p.targetColor.g - p.startColor.g) * progress; const b = p.startColor.b + (p.targetColor.b - p.startColor.b) * progress; p.color = `rgba(${Math.floor(r)}, ${Math.floor(g)}, ${Math.floor(b)}, 1)`; if (progress >= 1) p.isChangingColor = false; }
                    }
                });
            }
            updateRipples() { this.state.ripples = this.state.ripples.filter(r => Date.now() - r.startTime < r.duration); }
            
            async growBlossoms() { 
                const branchesWithPotential = this.state.branches.filter(b => b.depth > 3); 
                branchesWithPotential.forEach(branch => { 
                    if (this.prng.next() < this.config.BLOSSOM_DENSITY) { 
                        const spawnDelay = this.bellCurveRandom(2000); 
                        this.state.blossoms.push(this.createParticle(branch.endX, branch.endY, { type: 'blossom', colorIndex: Math.floor(this.prng.next() * this.config.BLOSSOM_COLORS.length), delay: spawnDelay, z: branch.z })); 
                    } 
                }); 
                await new Promise(resolve => this._setTimeout(resolve, 2000)); 
            }
            growCherries() { 
                const branchesWithPotential = this.state.branches.filter(b => b.depth > 2);
                branchesWithPotential.forEach(branch => { 
                    if (this.prng.next() < this.config.CHERRY_DENSITY) { 
                        this.state.cherries.push(this.createParticle(branch.endX, branch.endY, { type: 'cherry', colorIndex: Math.floor(this.prng.next() * this.config.CHERRY_COLORS.length), delay: this.prng.next() * 500, z: branch.z })); 
                    } 
                }); 
            }
            
            changeLeafColors() { this.state.leaves.forEach(l => { if (!l.falling) { this._setTimeout(() => { if (!l) return; l.isChangingColor = true; l.colorChangeStartTime = Date.now(); l.startColor = this.parseRgba(l.color); const targetRgba = this.config.LEAF_AUTUMN_COLORS[Math.floor(this.prng.next() * 3)]; l.targetColor = this.parseRgba(targetRgba); l.colorChangeDuration = 1500 + this.prng.next() * 1500; }, this.prng.next() * 2000); } }); }
            parseRgba(rgbaString) { const match = rgbaString.match(/(\d+(\.\d+)?)/g); if (!match) return { r: 0, g: 0, b: 0, a: 1 }; const [r, g, b, a] = match.map(Number); return { r, g, b, a: a || 1 }; }
            createRipple(x, y) { this.state.ripples.push({ x: x, y: y, startTime: Date.now(), duration: 2000 + this.prng.next() * 1000, maxWidth: 40 + this.prng.next() * 40 }); }
        }

        document.addEventListener('DOMContentLoaded', () => {
            if (window.crypto && window.crypto.getRandomValues) {
                new LushTree('growthCanvas', 'treeOrigin');
            } else {
                console.error('Secure random number generator (crypto.getRandomValues) is not available.');
            }
        });
