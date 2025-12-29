/* Copyright 2024 Pierre Millot
 *
 * Session Stats OLED Display for Aurora Corne
 */

#include QMK_KEYBOARD_H

#ifdef OLED_ENABLE

// Session statistics
static uint32_t session_start_time = 0;
static uint8_t  peak_wpm = 0;
static bool     session_started = false;
static uint32_t estimated_keystrokes = 0;
static uint32_t last_keystroke_update = 0;

// Render session stats (for slave side) - 5 chars wide
static void render_session_stats(void) {
    uint8_t current_wpm = get_current_wpm();
    char buf[6];  // 5 chars + null
    
    // Start session on first typing activity (WPM > 0)
    if (current_wpm > 0 && !session_started) {
        session_start_time = timer_read32();
        session_started = true;
    }
    
    // Update peak WPM
    if (current_wpm > peak_wpm) {
        peak_wpm = current_wpm;
    }
    
    // Estimate keystrokes from WPM (5 chars per word, update every second)
    if (current_wpm > 0 && timer_elapsed32(last_keystroke_update) > 1000) {
        estimated_keystrokes += (current_wpm * 5) / 60;  // keys per second
        last_keystroke_update = timer_read32();
    }
    
    // Title
    oled_write_P(PSTR("STATS"), false);
    oled_write_P(PSTR("====="), false);
    
    // Current WPM (label then value)
    oled_write_P(PSTR("WPM: "), false);
    snprintf(buf, sizeof(buf), "%5d", current_wpm);
    oled_write(buf, false);
    
    // WPM bar [===] style, 5 chars total
    oled_write_P(PSTR("["), false);
    uint8_t filled = current_wpm / 34;  // 0-3 for 0-100 WPM
    if (filled > 3) filled = 3;
    for (uint8_t i = 0; i < 3; i++) {
        oled_write_P(i < filled ? PSTR("=") : PSTR("-"), false);
    }
    oled_write_P(PSTR("]"), false);
    
    // Peak WPM
    oled_write_P(PSTR("PEAK:"), false);
    snprintf(buf, sizeof(buf), "%5d", peak_wpm);
    oled_write(buf, false);
    
    // Spacer
    oled_write_P(PSTR("     "), false);
    
    // Keystrokes (estimated from WPM)
    oled_write_P(PSTR("KEYS:"), false);
    if (estimated_keystrokes >= 100000) {
        snprintf(buf, sizeof(buf), "%4luK", (unsigned long)(estimated_keystrokes / 1000));
    } else {
        snprintf(buf, sizeof(buf), "%5lu", (unsigned long)estimated_keystrokes);
    }
    oled_write(buf, false);
    
    // Spacer
    oled_write_P(PSTR("     "), false);
    
    // Session time
    oled_write_P(PSTR("TIME:"), false);
    if (session_started) {
        uint32_t secs = timer_elapsed32(session_start_time) / 1000;
        uint32_t mins = secs / 60;
        uint32_t hrs = mins / 60;
        if (hrs > 0) {
            snprintf(buf, sizeof(buf), "%2luh%02lu", (unsigned long)hrs, (unsigned long)(mins % 60));
        } else {
            snprintf(buf, sizeof(buf), "%2lu:%02lu", (unsigned long)mins, (unsigned long)(secs % 60));
        }
        oled_write(buf, false);
    } else {
        oled_write_P(PSTR(" 0:00"), false);
    }
}

// Render layer and mod status (for master side) - 5 chars wide
static void render_status(void) {
    char buf[6];
    
    // Layer indicator
    oled_write_P(PSTR("LAYER"), false);
    switch (get_highest_layer(layer_state | default_layer_state)) {
        case 0:
            oled_write_P(PSTR(" BASE"), false);
            break;
        case 1:
            oled_write_P(PSTR("LOWER"), false);
            break;
        case 2:
            oled_write_P(PSTR("RAISE"), false);
            break;
        case 3:
            oled_write_P(PSTR(" ADJ "), false);
            break;
        default:
            oled_write_P(PSTR(" ??? "), false);
    }
    
    oled_write_P(PSTR("====="), false);
    
    // Modifier status (label then value on next line)
    oled_write_P(PSTR("MODS:"), false);
    uint8_t mods = get_mods() | get_oneshot_mods();
    oled_write_P((mods & MOD_MASK_SHIFT) ? PSTR("S") : PSTR("-"), false);
    oled_write_P((mods & MOD_MASK_CTRL)  ? PSTR("C") : PSTR("-"), false);
    oled_write_P((mods & MOD_MASK_ALT)   ? PSTR("A") : PSTR("-"), false);
    oled_write_P((mods & MOD_MASK_GUI)   ? PSTR("G") : PSTR("-"), false);
    oled_write_P(PSTR(" "), false);
    
    // Spacer
    oled_write_P(PSTR("     "), false);
    
    // Lock indicators
    oled_write_P(PSTR("LOCK:"), false);
    led_t led_state = host_keyboard_led_state();
    oled_write_P(led_state.caps_lock   ? PSTR("C") : PSTR("-"), false);
    oled_write_P(led_state.num_lock    ? PSTR("N") : PSTR("-"), false);
    oled_write_P(led_state.scroll_lock ? PSTR("S") : PSTR("-"), false);
    oled_write_P(PSTR("  "), false);
    
    // Spacer
    oled_write_P(PSTR("     "), false);
    
    // Current WPM
    oled_write_P(PSTR("WPM: "), false);
    snprintf(buf, sizeof(buf), "%5d", get_current_wpm());
    oled_write(buf, false);
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

