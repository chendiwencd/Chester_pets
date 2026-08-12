use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::state::PetPosition;

pub const PET_SIZE: f64 = 120.0;
// 和 public/pet/board.png 的原图比例(1600x900, 16:9)保持一致，避免 background-size:100% 100% 把木牌拉变形。
// 窗口比例
pub const PANEL_WIDTH: f64 = 240.0;
pub const PANEL_HEIGHT: f64 = 160.0;
pub const PREVIEW_WIDTH: f64 = 800.0;
pub const PREVIEW_HEIGHT: f64 = 450.0;
pub const IMAGE_VIEWER_WIDTH: f64 = 1000.0;
pub const IMAGE_VIEWER_HEIGHT: f64 = 700.0;
pub const CONTROL_PANEL_WIDTH: f64 = 980.0;
pub const CONTROL_PANEL_HEIGHT: f64 = 640.0;

#[derive(Clone, Copy)]
pub enum PanelKind {
    Image,
    Text,
    Web,
}

impl PanelKind {
    pub const ALL: [PanelKind; 3] = [PanelKind::Image, PanelKind::Text, PanelKind::Web];

    pub fn label(self) -> &'static str {
        match self {
            PanelKind::Image => "panel-img",
            PanelKind::Text => "panel-text",
            PanelKind::Web => "panel-web",
        }
    }
}

// 把一个窗口矩形（物理像素）压回到"某块显示器内部"。
//
// 为什么必须做：多显示器不一定拼成一个完整矩形（这台机器上 DISPLAY1 到 x=2560 结束，
// DISPLAY2 从 x=3840 才开始，中间 1280px 是任何屏幕都覆盖不到的空隙）；再叠加非 100%
// 缩放，宠物很容易被拖到屏幕边缘，按偏移量摆出去的面板就整个落在可视区外——窗口确实
// 创建了、show() 也返回成功，但用户什么都看不到，表现得就像"面板没打开"。
//
// 策略：挑一块和目标矩形重叠面积最大的显示器（完全不重叠时退回主显示器），
// 然后把矩形夹进这块显示器的范围内。
// 选出与目标矩形重叠面积最大的显示器边界(物理像素, (x, y, w, h))；完全不重叠(比如被拖进双屏
// 空隙)时退回主显示器。这是所有"钳制/边界翻转"逻辑的共同依据。
fn pick_monitor_bounds(
    app: &AppHandle,
    target: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> Option<(i32, i32, i32, i32)> {
    let monitors = app.available_monitors().unwrap_or_default();
    if monitors.is_empty() {
        return None;
    }

    let w = size.width as i32;
    let h = size.height as i32;
    let overlap_area = |m: &tauri::Monitor| -> i64 {
        let mp = m.position();
        let ms = m.size();
        let x_overlap = (target.x + w).min(mp.x + ms.width as i32) - target.x.max(mp.x);
        let y_overlap = (target.y + h).min(mp.y + ms.height as i32) - target.y.max(mp.y);
        if x_overlap <= 0 || y_overlap <= 0 {
            0
        } else {
            x_overlap as i64 * y_overlap as i64
        }
    };

    let primary_name = app
        .primary_monitor()
        .ok()
        .flatten()
        .and_then(|m| m.name().cloned());
    let best = monitors
        .iter()
        .max_by_key(|m| overlap_area(m))
        .filter(|m| overlap_area(m) > 0)
        .or_else(|| monitors.iter().find(|m| m.name() == primary_name.as_ref()))
        .unwrap_or(&monitors[0]);

    let mp = best.position();
    let ms = best.size();
    Some((mp.x, mp.y, ms.width as i32, ms.height as i32))
}

// 把一个窗口矩形（物理像素）压回到"某块显示器内部"。多屏不一定拼成完整矩形 + 非 100% 缩放下，
// 窗口很容易被算到可视区外，这里做最后兜底。
fn clamp_to_visible_area(
    app: &AppHandle,
    target: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    let Some((mx, my, mw, mh)) = pick_monitor_bounds(app, target, size) else {
        return target;
    };
    let w = size.width as i32;
    let h = size.height as i32;
    // 显示器可能比窗口还小，先算出合法区间再夹，避免 min > max 时 clamp panic。
    let max_x = (mx + mw - w).max(mx);
    let max_y = (my + mh - h).max(my);
    PhysicalPosition::new(target.x.clamp(mx, max_x), target.y.clamp(my, max_y))
}

// 主宠物窗口：无边框、置顶、不出现在任务栏，尺寸固定，背景透明（只看得到 gif 本身，
// 不带底色/背景板）。透明配套 CSS 那边 html/body/.pet-root 都要是 transparent，见 styles.css。
// DPI 说明：这里的坐标是逻辑像素，petView.ts 拖动/持久化时也统一用逻辑像素
// (LogicalPosition + outerPosition().toLogical(scaleFactor))，两边单位一致。
pub fn build_main_window(app: &AppHandle, position: PetPosition) -> tauri::Result<WebviewWindow> {
    println!(
        "[windows] build main position=({}, {}), size=({PET_SIZE}, {PET_SIZE})",
        position.x, position.y
    );
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("桌面宠物")
        .inner_size(PET_SIZE, PET_SIZE)
        .position(position.x as f64, position.y as f64)
        .decorations(false)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .transparent(true)
        .build()
        .inspect(|window| {
            // 存档里的坐标可能是上次被拖到屏幕边缘/双屏空隙时存下来的，直接还原会让宠物
            // 一启动就看不见。这里建完窗口后按真实尺寸夹回可见区域，并把回读结果打出来。
            if let (Ok(outer), Ok(size), Ok(scale)) =
                (window.outer_position(), window.outer_size(), window.scale_factor())
            {
                let clamped = clamp_to_visible_area(window.app_handle(), outer, size);
                if clamped != outer {
                    let _ = window.set_position(clamped);
                }
                println!(
                    "[windows] main built readback outer=({}, {}) size=({}, {}) scale={scale} final=({}, {})",
                    outer.x, outer.y, size.width, size.height, clamped.x, clamped.y
                );
            }
        })
}

// 三个内容面板窗口（图片/文本/网页），启动时就预创建，默认隐藏。
// 透明窗口已经确认可正常显示，保持透明底，只让 board.png 木板本体露出来。
pub fn build_panel_window(app: &AppHandle, kind: PanelKind) -> tauri::Result<WebviewWindow> {
    println!(
        "[windows] build {} size=({PANEL_WIDTH}, {PANEL_HEIGHT}) transparent=true visible=false",
        kind.label()
    );
    let window = WebviewWindowBuilder::new(app, kind.label(), WebviewUrl::App("panel.html".into()))
        .inner_size(PANEL_WIDTH, PANEL_HEIGHT)
        .decorations(false)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .transparent(true)
        .visible(false)
        .build()?;

    if let (Ok(outer), Ok(size), Ok(scale)) = (
        window.outer_position(),
        window.outer_size(),
        window.scale_factor(),
    ) {
        println!(
            "[windows] {} built readback outer=({}, {}) size=({}, {}) scale={} visible={}",
            kind.label(),
            outer.x,
            outer.y,
            size.width,
            size.height,
            scale,
            window.is_visible().unwrap_or(false)
        );
    }

    Ok(window)
}

pub fn build_preview_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    println!(
        "[windows] build preview size=({PREVIEW_WIDTH}, {PREVIEW_HEIGHT}) transparent=true visible=false resizable=true"
    );
    let window = WebviewWindowBuilder::new(app, "preview", WebviewUrl::App("preview.html".into()))
        .inner_size(PREVIEW_WIDTH, PREVIEW_HEIGHT)
        .decorations(false)
        .always_on_top(true)
        .resizable(true)
        .skip_taskbar(true)
        .shadow(false)
        .transparent(true)
        .visible(false)
        .build()?;

    if let (Ok(outer), Ok(size), Ok(scale)) = (
        window.outer_position(),
        window.outer_size(),
        window.scale_factor(),
    ) {
        println!(
            "[windows] preview built readback outer=({}, {}) size=({}, {}) scale={} visible={}",
            outer.x,
            outer.y,
            size.width,
            size.height,
            scale,
            window.is_visible().unwrap_or(false)
        );
    }

    Ok(window)
}

pub fn build_image_viewer_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    println!(
        "[windows] build image-viewer size=({IMAGE_VIEWER_WIDTH}, {IMAGE_VIEWER_HEIGHT}) visible=false resizable=true"
    );
    let window =
        WebviewWindowBuilder::new(app, "image-viewer", WebviewUrl::App("image-viewer.html".into()))
            .title("查看原图")
            .inner_size(IMAGE_VIEWER_WIDTH, IMAGE_VIEWER_HEIGHT)
            .always_on_top(true)
            .resizable(true)
            .skip_taskbar(true)
            .visible(false)
            .build()?;
    Ok(window)
}

pub fn build_control_panel_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    println!(
        "[windows] build control-panel size=({CONTROL_PANEL_WIDTH}, {CONTROL_PANEL_HEIGHT}) visible=false"
    );
    let window = WebviewWindowBuilder::new(
        app,
        "control-panel",
        WebviewUrl::App("control-panel.html".into()),
    )
    .title("控制面板")
    .inner_size(CONTROL_PANEL_WIDTH, CONTROL_PANEL_HEIGHT)
    .decorations(false)
    .resizable(true)
    .visible(false)
    .build()?;
    let _ = window.center();
    Ok(window)
}

pub fn show_control_panel(app: &AppHandle) -> tauri::Result<()> {
    let window = match app.get_webview_window("control-panel") {
        Some(existing) => existing,
        None => build_control_panel_window(app)?,
    };
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

pub fn build_all_panel_windows(app: &AppHandle, _position: PetPosition) -> tauri::Result<()> {
    // 以主窗口真实的物理坐标 + 所在屏缩放为准来摆放子窗口（主窗口在 build_main_window 里可能已被
    // 钳制过，未必等于传入的存档坐标）。
    let (main_x, main_y, main_scale) = match app.get_webview_window("main") {
        Some(main) => {
            let pos = main.outer_position().unwrap_or(PhysicalPosition::new(0, 0));
            let scale = main.scale_factor().unwrap_or(1.0);
            (pos.x, pos.y, scale)
        }
        None => (0, 0, 1.0),
    };
    println!(
        "[windows] prebuild all panels around main phys=({main_x}, {main_y}) scale={main_scale}"
    );
    for kind in PanelKind::ALL {
        if app.get_webview_window(kind.label()).is_none() {
            build_panel_window(app, kind)?;
        } else {
            println!("[windows] {} already exists during setup", kind.label());
        }
    }
    position_panels_around(app, main_x, main_y, main_scale);

    // 预览窗口：默认隐藏，点击内容时才显示
    let preview = match app.get_webview_window("preview") {
        Some(existing) => existing,
        None => build_preview_window(app)?,
    };
    position_preview(&preview, main_x, main_y, main_scale);

    let image_viewer = match app.get_webview_window("image-viewer") {
        Some(existing) => existing,
        None => build_image_viewer_window(app)?,
    };
    position_image_viewer(&image_viewer, main_x, main_y, main_scale);

    if app.get_webview_window("control-panel").is_none() {
        let _ = build_control_panel_window(app)?;
    }
    Ok(())
}

// 子窗口定位统一走这里：全部用物理坐标。
//
// 关键点（也是"面板显示在另一块屏"这个 bug 的根因）：逻辑偏移量必须乘以**主窗口所在屏的缩放**
// 换算成物理偏移，再加到主窗口的物理坐标上——绝不能用子窗口自己当前所在屏的缩放去换算，
// 因为子窗口可能还停在别的屏上（缩放不同），那样算出来就会落回原来那块屏。
// main_x/main_y 是主窗口的物理坐标，main_scale 是主窗口所在屏的缩放。
fn place_child(
    window: &WebviewWindow,
    main_x: i32,
    main_y: i32,
    main_scale: f64,
    dx_logical: i32,
    dy_logical: i32,
    fallback_w_logical: f64,
    fallback_h_logical: f64,
    label: &str,
) {
    let target = PhysicalPosition::new(
        main_x + (dx_logical as f64 * main_scale).round() as i32,
        main_y + (dy_logical as f64 * main_scale).round() as i32,
    );
    let size = window.outer_size().unwrap_or_else(|_| {
        PhysicalSize::new(
            (fallback_w_logical * main_scale) as u32,
            (fallback_h_logical * main_scale) as u32,
        )
    });
    let clamped = clamp_to_visible_area(window.app_handle(), target, size);
    println!(
        "[windows] place {label} main_phys=({main_x}, {main_y}) scale={main_scale} offset_logical=({dx_logical}, {dy_logical}) -> ({}, {})",
        clamped.x, clamped.y
    );
    if let Err(err) = window.set_position(clamped) {
        eprintln!("[windows] failed to set position for {label}: {err}");
    }
}

pub fn position_preview(window: &WebviewWindow, main_x: i32, main_y: i32, main_scale: f64) {
    // 预览默认放在宠物正上方，居中对齐
    const GAP: i32 = 20;
    let dx = -((PREVIEW_WIDTH as i32 - PET_SIZE as i32) / 2);
    let dy = -(GAP + PREVIEW_HEIGHT as i32);
    place_child(
        window, main_x, main_y, main_scale, dx, dy, PREVIEW_WIDTH, PREVIEW_HEIGHT, "preview",
    );
}

pub fn position_image_viewer(window: &WebviewWindow, main_x: i32, main_y: i32, main_scale: f64) {
    const GAP: i32 = 24;
    let dx = -((IMAGE_VIEWER_WIDTH as i32 - PET_SIZE as i32) / 2);
    let dy = -(GAP + IMAGE_VIEWER_HEIGHT as i32);
    place_child(
        window,
        main_x,
        main_y,
        main_scale,
        dx,
        dy,
        IMAGE_VIEWER_WIDTH,
        IMAGE_VIEWER_HEIGHT,
        "image-viewer",
    );
}

// 同时摆放三个面板，并做"屏幕边界翻转"：
// 每个面板有一组按优先级排列的候选侧(上/下/左/右)，从中挑第一个「未被别的面板占用且在宠物所在屏
// 完整放得下」的侧；靠边导致首选侧放不下时会自动翻到另一侧，几个面板各占一侧，既不会盖住宠物、
// 也不会互相重叠，且始终整块可见。main_x/main_y 为宠物物理坐标，main_scale 为宠物所在屏缩放。
pub fn position_panels_around(app: &AppHandle, main_x: i32, main_y: i32, main_scale: f64) {
    // 宠物物理尺寸（优先读真实窗口尺寸，读不到再按逻辑尺寸×缩放估算）
    let (pet_w, pet_h) = app
        .get_webview_window("main")
        .and_then(|w| w.outer_size().ok())
        .map(|s| (s.width as i32, s.height as i32))
        .unwrap_or(((PET_SIZE * main_scale) as i32, (PET_SIZE * main_scale) as i32));
    // 面板物理尺寸（三个同尺寸）
    let (pan_w, pan_h) = app
        .get_webview_window("panel-img")
        .and_then(|w| w.outer_size().ok())
        .map(|s| (s.width as i32, s.height as i32))
        .unwrap_or((
            (PANEL_WIDTH * main_scale) as i32,
            (PANEL_HEIGHT * main_scale) as i32,
        ));
    let gap = (20.0 * main_scale).round() as i32;

    // 宠物所在显示器边界
    let (mx, my, mw, mh) = pick_monitor_bounds(
        app,
        PhysicalPosition::new(main_x, main_y),
        PhysicalSize::new(pet_w as u32, pet_h as u32),
    )
    .unwrap_or((main_x, main_y, pet_w, pet_h));

    // 0=左 1=右 2=上 3=下：给定侧，算面板左上角(沿宠物居中对齐)
    let candidate = |side: u8| -> (i32, i32) {
        match side {
            0 => (main_x - gap - pan_w, main_y + (pet_h - pan_h) / 2),
            1 => (main_x + pet_w + gap, main_y + (pet_h - pan_h) / 2),
            2 => (main_x + (pet_w - pan_w) / 2, main_y - gap - pan_h),
            _ => (main_x + (pet_w - pan_w) / 2, main_y + pet_h + gap),
        }
    };
    let fits = |(x, y): (i32, i32)| -> bool {
        x >= mx && y >= my && x + pan_w <= mx + mw && y + pan_h <= my + mh
    };

    // 面板 -> 候选侧优先级。图片默认左、文本默认上、网页默认右；放不下时优先翻到"下"，再上/另一侧。
    let prefs: [(PanelKind, [u8; 4]); 3] = [
        (PanelKind::Image, [0, 3, 2, 1]),
        (PanelKind::Text, [2, 3, 1, 0]),
        (PanelKind::Web, [1, 3, 2, 0]),
    ];
    let mut taken = [false; 4];
    for (kind, order) in prefs {
        // 优先：未占用且完整放得下；退一步：仅未占用(允许被钳制)；再退：首选侧。
        let side = order
            .iter()
            .copied()
            .find(|&s| !taken[s as usize] && fits(candidate(s)))
            .or_else(|| order.iter().copied().find(|&s| !taken[s as usize]))
            .unwrap_or(order[0]);
        taken[side as usize] = true;

        let (tx, ty) = candidate(side);
        let clamped = clamp_to_visible_area(
            app,
            PhysicalPosition::new(tx, ty),
            PhysicalSize::new(pan_w as u32, pan_h as u32),
        );
        if let Some(window) = app.get_webview_window(kind.label()) {
            let _ = window.set_position(clamped);
            println!(
                "[windows] panel {} side={} -> ({}, {})",
                kind.label(),
                side,
                clamped.x,
                clamped.y
            );
        }
    }
}
