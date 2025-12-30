/* Copyright 2024 Pierre Millot
 *
 * Interactive Game of Life for Aurora Corne OLED
 * Keypresses inject random life into the simulation!
 */

#include QMK_KEYBOARD_H

#ifdef OLED_ENABLE

// Grid dimensions - OLED is 32x128 after 270° rotation
// Using 4x4 pixel cells = 8 columns x 32 rows
#define GRID_W 8
#define GRID_H 32
#define CELL_SIZE 4

// Two buffers for double-buffering the simulation
static uint8_t grid[GRID_H];      // Current state (8 bits = 8 columns per row)
static uint8_t next_grid[GRID_H]; // Next generation

// Timing
static uint32_t last_update = 0;
#define UPDATE_INTERVAL 150  // ms between generations

// Simple pseudo-random number generator
static uint16_t rng_state = 12345;
static uint8_t random8(void) {
    rng_state ^= rng_state << 7;
    rng_state ^= rng_state >> 9;
    rng_state ^= rng_state << 8;
    return (uint8_t)(rng_state & 0xFF);
}

// Seed the grid with random pattern
static void seed_grid(void) {
    for (uint8_t y = 0; y < GRID_H; y++) {
        grid[y] = random8() & random8();  // ~25% density
    }
}

// Get cell state (with wrapping)
static bool get_cell(int8_t x, int8_t y) {
    // Wrap coordinates
    if (x < 0) x += GRID_W;
    if (x >= GRID_W) x -= GRID_W;
    if (y < 0) y += GRID_H;
    if (y >= GRID_H) y -= GRID_H;
    
    return (grid[y] >> x) & 1;
}

// Set cell in next_grid
static void set_next_cell(uint8_t x, uint8_t y, bool alive) {
    if (alive) {
        next_grid[y] |= (1 << x);
    } else {
        next_grid[y] &= ~(1 << x);
    }
}

// Count living neighbors
static uint8_t count_neighbors(uint8_t x, uint8_t y) {
    uint8_t count = 0;
    for (int8_t dy = -1; dy <= 1; dy++) {
        for (int8_t dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) continue;
            if (get_cell(x + dx, y + dy)) count++;
        }
    }
    return count;
}

// Compute next generation
static void step_simulation(void) {
    // Clear next grid
    for (uint8_t y = 0; y < GRID_H; y++) {
        next_grid[y] = 0;
    }
    
    // Apply Game of Life rules
    for (uint8_t y = 0; y < GRID_H; y++) {
        for (uint8_t x = 0; x < GRID_W; x++) {
            uint8_t neighbors = count_neighbors(x, y);
            bool alive = get_cell(x, y);
            
            // Rules: B3/S23 (standard Life)
            if (alive) {
                set_next_cell(x, y, neighbors == 2 || neighbors == 3);
            } else {
                set_next_cell(x, y, neighbors == 3);
            }
        }
    }
    
    // Copy next to current
    for (uint8_t y = 0; y < GRID_H; y++) {
        grid[y] = next_grid[y];
    }
}

// Check if grid is empty or static (for auto-reset)
static bool is_grid_dead(void) {
    for (uint8_t y = 0; y < GRID_H; y++) {
        if (grid[y] != 0) return false;
    }
    return true;
}

// Inject some random life (called on keypress)
static void inject_life(void) {
    // Add a few random cells
    for (uint8_t i = 0; i < 5; i++) {
        uint8_t y = random8() % GRID_H;
        uint8_t x = random8() % GRID_W;
        grid[y] |= (1 << x);
    }
    // Also add a glider for fun
    uint8_t gy = random8() % (GRID_H - 3);
    uint8_t gx = random8() % (GRID_W - 3);
    // Glider pattern
    grid[gy] |= (1 << ((gx + 1) % GRID_W));
    grid[gy + 1] |= (1 << ((gx + 2) % GRID_W));
    grid[gy + 2] |= (1 << (gx % GRID_W));
    grid[gy + 2] |= (1 << ((gx + 1) % GRID_W));
    grid[gy + 2] |= (1 << ((gx + 2) % GRID_W));
}

// Draw the grid to OLED
static void draw_grid(void) {
    for (uint8_t y = 0; y < GRID_H; y++) {
        for (uint8_t x = 0; x < GRID_W; x++) {
            bool alive = (grid[y] >> x) & 1;
            // Draw 4x4 cell (but leave 1px gap for grid look)
            for (uint8_t py = 0; py < CELL_SIZE - 1; py++) {
                for (uint8_t px = 0; px < CELL_SIZE - 1; px++) {
                    oled_write_pixel(x * CELL_SIZE + px, y * CELL_SIZE + py, alive);
                }
            }
        }
    }
}

// Generation counter
static uint16_t generation = 0;
static bool initialized = false;
static uint32_t last_inject = 0;
static uint8_t last_wpm = 0;
#define INJECT_COOLDOWN 200  // ms between injections to avoid spam

bool oled_task_user(void) {
    // Initialize on first run
    if (!initialized) {
        rng_state = timer_read() ^ (is_keyboard_master() ? 0xABCD : 0x1234);
        seed_grid();
        initialized = true;
        last_update = timer_read32();
        last_inject = timer_read32();
    }
    
    // Update simulation at fixed interval
    if (timer_elapsed32(last_update) > UPDATE_INTERVAL) {
        step_simulation();
        generation++;
        last_update = timer_read32();
        
        // Auto-reset if grid dies
        if (is_grid_dead()) {
            seed_grid();
            generation = 0;
        }
    }
    
    // Slave side: detect typing via WPM changes (WPM is synced from master)
    // Inject life when WPM increases (indicates active typing)
    if (!is_keyboard_master()) {
        uint8_t current_wpm = get_current_wpm();
        if (current_wpm > last_wpm && timer_elapsed32(last_inject) > INJECT_COOLDOWN) {
            inject_life();
            rng_state ^= current_wpm;  // Add some variety
            last_inject = timer_read32();
        }
        last_wpm = current_wpm;
    }
    
    // Clear and redraw
    oled_clear();
    draw_grid();
    
    return false;
}

// Inject life on keypress for interactivity
bool process_record_user(uint16_t keycode, keyrecord_t *record) {
    if (record->event.pressed) {
        // Mix key timing into RNG for variety
        rng_state ^= timer_read();
        rng_state ^= keycode;
        
        // Inject life on any keypress
        inject_life();
    }
    return true;
}

#endif // OLED_ENABLE
