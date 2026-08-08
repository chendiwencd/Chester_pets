use tauri::{
    AppHandle, LogicalPosition, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
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

    // 相对宠物窗口左上角的逻辑像素偏移。主窗口和面板窗口都用逻辑像素定位，
    // 避免在非 100% 缩放下把主窗口的逻辑尺寸和面板的物理位置混在一起，导致
    // 面板贴合位置错乱，甚至看起来像"没出现"。
    pub fn offset(self) -> (i32, i32) {
        const GAP: i32 = 20;
        match self {
            PanelKind::Image => (-(GAP + PANEL_WIDTH as i32), -((PANEL_HEIGHT as i32 - PET_SIZE as i32) / 2)),
            PanelKind::Text => (
                -((PANEL_WIDTH as i32 - PET_SIZE as i32) / 2),
                -(GAP + PANEL_HEIGHT as i32),
            ),
            PanelKind::Web => (PET_SIZE as i32 + GAP, -((PANEL_HEIGHT as i32 - PET_SIZE as i32) / 2)),
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
fn clamp_to_visible_area(
    app: &AppHandle,
    target: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    let monitors = app.available_monitors().unwrap_or_default();
    if monitors.is_empty() {
        return target;
    }

    let w = size.width as i32;
    let h = size.height as i32;

    let overlap_area = |m: &tauri::Monitor| -> i64 {
        let mp = m.position();
        let ms = m.size();
        let x_overlap =
            (target.x + w).min(mp.x + ms.width as i32) - target.x.max(mp.x);
        let y_overlap =
            (target.y + h).min(mp.y + ms.height as i32) - target.y.max(mp.y);
        if x_overlap <= 0 || y_overlap <= 0 {
            0
        } else {
            x_overlap as i64 * y_overlap as i64
        }
    };

    // 完全不和任何显示器重叠时（比如被拖进了双屏之间的空隙），退回主显示器。
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
    // 显示器可能比窗口还小，先算出合法区间再夹，避免 min > max 时 clamp panic。
    let max_x = (mp.x + ms.width as i32 - w).max(mp.x);
    let max_y = (mp.y + ms.height as i32 - h).max(mp.y);
    let clamped = PhysicalPosition::new(target.x.clamp(mp.x, max_x), target.y.clamp(mp.y, max_y));

    if clamped != target {
        println!(
            "[windows] clamped ({}, {}) -> ({}, {}) into monitor pos=({}, {}) size=({}, {})",
            target.x, target.y, clamped.x, clamped.y, mp.x, mp.y, ms.width, ms.height
        );
    }
    clamped
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

pub fn build_all_panel_windows(app: &AppHandle, position: PetPosition) -> tauri::Result<()> {
    println!(
        "[windows] prebuild all panels around main logical=({}, {})",
        position.x, position.y
    );
    for kind in PanelKind::ALL {
        let window = match app.get_webview_window(kind.label()) {
            Some(existing) => {
                println!("[windows] {} already exists during setup", kind.label());
                existing
            }
            None => build_panel_window(app, kind)?,
        };
        position_panel(&window, kind, position.x, position.y);
    }

    // 预览窗口：默认隐藏，点击内容时才显示
    let preview = match app.get_webview_window("preview") {
        Some(existing) => existing,
        None => build_preview_window(app)?,
    };
    position_preview(&preview, position.x, position.y);

    let image_viewer = match app.get_webview_window("image-viewer") {
        Some(existing) => existing,
        None => build_image_viewer_window(app)?,
    };
    position_image_viewer(&image_viewer, position.x, position.y);

    if app.get_webview_window("control-panel").is_none() {
        let _ = build_control_panel_window(app)?;
    }
    Ok(())
}

pub fn position_preview(window: &WebviewWindow, main_x: i32, main_y: i32) {
    // 预览默认放在宠物正上方，居中对齐
    const GAP: i32 = 20;
    let dx = -((PREVIEW_WIDTH as i32 - PET_SIZE as i32) / 2);
    let dy = -(GAP + PREVIEW_HEIGHT as i32);
    let logical_target = LogicalPosition::new(main_x + dx, main_y + dy);
    println!(
        "[windows] position preview main=({}, {}) offset=({}, {}) logical_target=({}, {})",
        main_x, main_y, dx, dy, logical_target.x, logical_target.y
    );

    let Ok(scale) = window.scale_factor() else {
        let _ = window.set_position(logical_target);
        return;
    };
    let physical_target: PhysicalPosition<i32> = logical_target.to_physical(scale);
    let size = window
        .outer_size()
        .unwrap_or_else(|_| PhysicalSize::new((PREVIEW_WIDTH * scale) as u32, (PREVIEW_HEIGHT * scale) as u32));
    let clamped = clamp_to_visible_area(window.app_handle(), physical_target, size);
    let _ = window.set_position(clamped);
}

pub fn position_image_viewer(window: &WebviewWindow, main_x: i32, main_y: i32) {
    const GAP: i32 = 24;
    let dx = -((IMAGE_VIEWER_WIDTH as i32 - PET_SIZE as i32) / 2);
    let dy = -(GAP + IMAGE_VIEWER_HEIGHT as i32);
    let logical_target = LogicalPosition::new(main_x + dx, main_y + dy);

    let Ok(scale) = window.scale_factor() else {
        let _ = window.set_position(logical_target);
        return;
    };
    let physical_target: PhysicalPosition<i32> = logical_target.to_physical(scale);
    let size = window.outer_size().unwrap_or_else(|_| {
        PhysicalSize::new(
            (IMAGE_VIEWER_WIDTH * scale) as u32,
            (IMAGE_VIEWER_HEIGHT * scale) as u32,
        )
    });
    let clamped = clamp_to_visible_area(window.app_handle(), physical_target, size);
    let _ = window.set_position(clamped);
}

// 每次打开面板时都重新贴合宠物当前位置（面板关闭期间宠物可能已被拖动过）。
// 这里统一使用逻辑像素，和 build_main_window / petView.ts 保持一致。
pub fn position_panel(window: &WebviewWindow, kind: PanelKind, main_x: i32, main_y: i32) {
    let (dx, dy) = kind.offset();
    let logical_target = LogicalPosition::new(main_x + dx, main_y + dy);
    println!(
        "[windows] position {} main=({}, {}) offset=({}, {}) logical_target=({}, {})",
        kind.label(),
        main_x,
        main_y,
        dx,
        dy,
        logical_target.x,
        logical_target.y
    );

    // 夹回可见区域这一步必须在物理像素空间做（显示器边界本身就是物理像素给的），
    // 所以这里先把逻辑坐标换算成物理坐标，夹完再直接按物理坐标设置。
    let Ok(scale) = window.scale_factor() else {
        let _ = window.set_position(logical_target);
        return;
    };
    let physical_target: PhysicalPosition<i32> = logical_target.to_physical(scale);
    let size = window
        .outer_size()
        .unwrap_or_else(|_| PhysicalSize::new((PANEL_WIDTH * scale) as u32, (PANEL_HEIGHT * scale) as u32));

    let clamped = clamp_to_visible_area(window.app_handle(), physical_target, size);
    if let Err(err) = window.set_position(clamped) {
        eprintln!("[windows] failed to set position for {}: {err}", kind.label());
    }
}
