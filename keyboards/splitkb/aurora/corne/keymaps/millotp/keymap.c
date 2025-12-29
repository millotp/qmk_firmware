/* Copyright 2024 Pierre Millot
 *
 * Session Stats OLED Display for Aurora Corne
 */

#include QMK_KEYBOARD_H

#ifdef OLED_ENABLE

// Session statistics
static uint32_t session_keystrokes = 0;
static uint32_t session_start_time = 0;
static uint8_t  peak_wpm = 0;
static bool     session_started = false;

// Track keypresses for stats
bool process_record_user(uint16_t keycode, keyrecord_t *record) {
    if (record->event.pressed) {
        session_keystrokes++;
        
        // Start session timer on first keypress
        if (!session_started) {
            session_start_time = timer_read32();
            session_started = true;
        }
        
        // Track peak WPM
        uint8_t current_wpm = get_current_wpm();
        if (current_wpm > peak_wpm) {
            peak_wpm = current_wpm;
        }
    }
    return true;
}

// Format number with commas for readability (e.g., 1,234)
static void write_number(uint32_t num) {
    char buf[12];
    if (num >= 1000000) {
        snprintf(buf, sizeof(buf), "%luM", (unsigned long)(num / 1000000));
    } else if (num >= 1000) {
        snprintf(buf, sizeof(buf), "%lu,%03lu", (unsigned long)(num / 1000), (unsigned long)(num % 1000));
    } else {
        snprintf(buf, sizeof(buf), "%lu", (unsigned long)num);
    }
    oled_write(buf, false);
}

// Format time as HH:MM or MM:SS
static void write_time(uint32_t ms) {
    uint32_t seconds = ms / 1000;
    uint32_t minutes = seconds / 60;
    uint32_t hours = minutes / 60;
    
    char buf[8];
    if (hours > 0) {
        snprintf(buf, sizeof(buf), "%luh%02lu", (unsigned long)hours, (unsigned long)(minutes % 60));
    } else {
        snprintf(buf, sizeof(buf), "%lu:%02lu", (unsigned long)minutes, (unsigned long)(seconds % 60));
    }
    oled_write(buf, false);
}

// Render session stats (for slave side)
static void render_session_stats(void) {
    uint8_t current_wpm = get_current_wpm();
    
    // Update peak WPM
    if (current_wpm > peak_wpm) {
        peak_wpm = current_wpm;
    }
    
    // Title
    oled_write_P(PSTR("STATS"), false);
    oled_write_P(PSTR("-----"), false);
    
    // Current WPM with bar visualization
    oled_write_P(PSTR("WPM  "), false);
    char wpm_str[4];
    snprintf(wpm_str, sizeof(wpm_str), "%3d", current_wpm);
    oled_write(wpm_str, false);
    
    // WPM bar (5 chars wide, max ~100 WPM)
    oled_write_P(PSTR("["), false);
    uint8_t filled = current_wpm / 25;  // 0-4 blocks for 0-100 WPM
    if (filled > 4) filled = 4;
    for (uint8_t i = 0; i < 4; i++) {
        if (i < filled) {
            oled_write_P(PSTR("#"), false);
        } else {
            oled_write_P(PSTR(" "), false);
        }
    }
    oled_write_P(PSTR("]"), false);
    
    // Peak WPM
    oled_write_P(PSTR("PEAK "), false);
    snprintf(wpm_str, sizeof(wpm_str), "%3d", peak_wpm);
    oled_write(wpm_str, false);
    
    // Spacer
    oled_write_P(PSTR("     "), false);
    
    // Keystrokes
    oled_write_P(PSTR("KEYS "), false);
    write_number(session_keystrokes);
    
    // Spacer
    oled_write_P(PSTR("     "), false);
    
    // Session time
    oled_write_P(PSTR("TIME "), false);
    if (session_started) {
        write_time(timer_elapsed32(session_start_time));
    } else {
        oled_write_P(PSTR("0:00"), false);
    }
}

// Render layer and mod status (for master side) - similar to default
static void render_status(void) {
    // Layer indicator
    oled_write_P(PSTR("LAYER"), false);
    switch (get_highest_layer(layer_state | default_layer_state)) {
        case 0:
            oled_write_P(PSTR("Base "), false);
            break;
        case 1:
            oled_write_P(PSTR("Lower"), false);
            break;
        case 2:
            oled_write_P(PSTR("Raise"), false);
            break;
        case 3:
            oled_write_P(PSTR("Adj  "), false);
            break;
        default:
            oled_write_P(PSTR("???? "), false);
    }
    
    oled_write_P(PSTR("     "), false);
    
    // Modifier status
    uint8_t mods = get_mods() | get_oneshot_mods();
    oled_write_P(PSTR("MODS "), false);
    oled_write_P((mods & MOD_MASK_SHIFT) ? PSTR("S") : PSTR("-"), false);
    oled_write_P((mods & MOD_MASK_CTRL)  ? PSTR("C") : PSTR("-"), false);
    oled_write_P((mods & MOD_MASK_ALT)   ? PSTR("A") : PSTR("-"), false);
    oled_write_P((mods & MOD_MASK_GUI)   ? PSTR("G") : PSTR("-"), false);
    
    oled_write_P(PSTR("     "), false);
    
    // Lock indicators
    led_t led_state = host_keyboard_led_state();
    oled_write_P(PSTR("LOCK "), false);
    oled_write_P(led_state.caps_lock   ? PSTR("C") : PSTR("-"), false);
    oled_write_P(led_state.num_lock    ? PSTR("N") : PSTR("-"), false);
    oled_write_P(led_state.scroll_lock ? PSTR("S") : PSTR("-"), false);
    oled_write_P(PSTR(" "), false);
    
    oled_write_P(PSTR("     "), false);
    
    // Current WPM (quick glance)
    oled_write_P(PSTR("WPM  "), false);
    char wpm_str[4];
    snprintf(wpm_str, sizeof(wpm_str), "%3d", get_current_wpm());
    oled_write(wpm_str, false);
}

bool oled_task_user(void) {
    if (is_keyboard_master()) {
        render_status();
    } else {
        render_session_stats();
    }
    return false;  // Don't run keyboard-level OLED code
}

#endif // OLED_ENABLE

