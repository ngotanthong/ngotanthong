
import { Bill } from '../types';

// Dịch vụ chuẩn của máy in nhiệt Bluetooth (thường gặp)
const PRINT_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const PRINT_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb';

let printDevice: any = null;
let printCharacteristic: any = null;

// Hàm xóa dấu Tiếng Việt để in an toàn trên máy in nhiệt giá rẻ
const removeAccents = (str: string): string => {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D");
};

// Hàm căn đều hai bên (justify) cho một đoạn văn bản dài
const justifyParagraph = (text: string, maxLength: number = 32): string[] => {
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return [""];

  const lines: string[][] = [];
  let currentLine: string[] = [];
  let currentLength = 0;

  for (const word of words) {
    if (currentLine.length > 0 && currentLength + 1 + word.length > maxLength) {
      lines.push(currentLine);
      currentLine = [word];
      currentLength = word.length;
    } else {
      currentLine.push(word);
      currentLength += (currentLine.length === 1 ? 0 : 1) + word.length;
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineWords = lines[i];
    const isLastLine = i === lines.length - 1;

    if (isLastLine || lineWords.length === 1) {
      // Dòng cuối hoặc dòng chỉ có 1 từ: Căn lề trái
      result.push(lineWords.join(' '));
    } else {
      // Các dòng ở giữa: Căn đều 2 bên (Justified) bằng cách phân bổ khoảng trắng
      const totalChars = lineWords.reduce((sum, w) => sum + w.length, 0);
      const totalSpaces = maxLength - totalChars;
      const gaps = lineWords.length - 1;

      const baseSpaces = Math.floor(totalSpaces / gaps);
      const remainder = totalSpaces % gaps;

      let lineStr = "";
      for (let j = 0; j < lineWords.length; j++) {
        lineStr += lineWords[j];
        if (j < gaps) {
          const spacesCount = baseSpaces + (j < remainder ? 1 : 0);
          lineStr += ' '.repeat(spacesCount);
        }
      }
      result.push(lineStr);
    }
  }

  return result;
};

// Hàm xuống dòng tự động theo độ rộng khổ giấy (mặc định 32 ký tự cho khổ 58mm)
// Hỗ trợ căn đều hai bên (justify) đối với các đoạn văn bản dài
const wrapText = (text: string, maxLength: number = 32): string[] => {
  const lines = text.split(/\r?\n/);
  const result: string[] = [];

  for (const line of lines) {
    if (line.includes('---') || line.includes('===') || line.length <= maxLength) {
      result.push(line);
    } else {
      result.push(...justifyParagraph(line, maxLength));
    }
  }

  return result;
};

// Hàm căn chỉnh lề cho cặp nhãn - giá trị (Label - Value)
// Nếu ngắn: Label căn trái, Value căn phải. Nếu dài: chuyển sang dạng đoạn văn căn đều 2 bên (Justified)
// Hỗ trợ nhận diện và ngắt dòng thực tế (\n) từ Google Sheets
const wrapLeftRight = (label: string, value: string, maxLength: number = 32): string[] => {
  const cleanLabel = label.trim();
  const cleanValue = value.trim();

  // Hỗ trợ ký tự xuống dòng (\n hoặc \r\n) từ Google Sheets
  if (cleanValue.includes('\n') || cleanValue.includes('\r')) {
    const parts = cleanValue.split(/\r?\n/);
    const result: string[] = [];

    // Dòng đầu tiên đi kèm với label
    result.push(...wrapLeftRight(cleanLabel, parts[0], maxLength));

    // Các dòng tiếp theo in rời (không kèm label)
    for (let i = 1; i < parts.length; i++) {
      if (parts[i].trim().length > 0) {
        result.push(...justifyParagraph(parts[i].trim(), maxLength));
      }
    }
    return result;
  }

  // Nếu tổng độ dài nhỏ hơn hoặc bằng maxLength, dàn đều trên 1 dòng (Trái - Phải)
  if (cleanLabel.length + cleanValue.length <= maxLength) {
    const spacesCount = maxLength - cleanLabel.length - cleanValue.length;
    return [cleanLabel + ' '.repeat(spacesCount) + cleanValue];
  }

  // Nếu vượt quá maxLength, gộp thành 1 dòng rồi căn đều hai bên (Justified)
  return justifyParagraph(`${cleanLabel} ${cleanValue}`, maxLength);
};

// Hàm chuyển đổi số thành chữ Tiếng Việt (Không dấu để in thermal)
const numberToWordsNoAccent = (total: number): string => {
  if (total === 0) return "Khong dong";

  const units = ["", "mot", "hai", "ba", "bon", "nam", "sau", "bay", "tam", "chin"];
  const levels = ["", "nghin", "trieu", "ty"];

  const readThreeDigits = (num: number, isLast: boolean): string => {
    let res = "";
    const h = Math.floor(num / 100);
    const t = Math.floor((num % 100) / 10);
    const u = num % 10;

    if (h > 0) {
      res += units[h] + " tram ";
    } else if (!isLast) {
      res += "khong tram ";
    }

    if (t > 1) {
      res += units[t] + " muoi ";
      if (u === 1) res += "mot";
      else if (u === 5) res += "lam";
      else if (u > 0) res += units[u];
    } else if (t === 1) {
      res += "muoi ";
      if (u === 5) res += "lam";
      else if (u > 0) res += units[u];
    } else if (u > 0) {
      if (!isLast || h > 0) res += "le ";
      res += units[u];
    }
    return res.trim();
  };

  let res = "";
  let levelIdx = 0;
  let remaining = total;

  while (remaining > 0) {
    const chunk = remaining % 1000;
    if (chunk > 0) {
      const chunkStr = readThreeDigits(chunk, remaining < 1000);
      res = chunkStr + " " + levels[levelIdx] + " " + res;
    }
    remaining = Math.floor(remaining / 1000);
    levelIdx++;
  }

  res = res.trim();
  return res.charAt(0).toUpperCase() + res.slice(1) + " dong";
};

export const connectPrinter = async (): Promise<string> => {
  try {
    if (!(navigator as any).bluetooth) {
      throw new Error("Trình duyệt này không hỗ trợ Web Bluetooth. Hãy dùng Chrome trên Android/Windows.");
    }

    const device = await (navigator as any).bluetooth.requestDevice({
      filters: [{ services: [PRINT_SERVICE_UUID] }],
      optionalServices: [PRINT_SERVICE_UUID]
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(PRINT_SERVICE_UUID);
    printCharacteristic = await service.getCharacteristic(PRINT_CHARACTERISTIC_UUID);
    printDevice = device;

    device.addEventListener('gattserverdisconnected', () => {
      printDevice = null;
      printCharacteristic = null;
      console.log("Printer disconnected");
    });

    return device.name || "Máy in Bluetooth";
  } catch (error) {
    console.error("Bluetooth Error:", error);
    throw error;
  }
};

export const disconnectPrinter = () => {
  if (printDevice && printDevice.gatt.connected) {
    printDevice.gatt.disconnect();
  }
  printDevice = null;
  printCharacteristic = null;
};

// Hàm gửi dữ liệu xuống máy in với cơ chế an toàn (Chunking + Retry)
const sendData = async (data: Uint8Array) => {
  if (!printCharacteristic) throw new Error("Chưa kết nối máy in!");

  // GIẢM KÍCH THƯỚC CHUNK: Bluetooth LE thường có MTU thấp (~23 bytes).
  // 100 bytes quá lớn, gây lỗi GATT operation failed.
  // 40 bytes là mức an toàn cho hầu hết máy in nhiệt Bluetooth.
  const CHUNK_SIZE = 40;

  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.slice(i, i + CHUNK_SIZE);

    let retries = 0;
    let success = false;

    // Cơ chế Retry nếu gặp lỗi GATT (do nghẽn buffer)
    while (!success && retries < 3) {
      try {
        await printCharacteristic.writeValue(chunk);
        success = true;
      } catch (error) {
        console.warn(`Ghi chunk thất bại (lần ${retries + 1}), đang thử lại...`, error);
        retries++;
        // Backoff delay: Chờ lâu hơn mỗi lần retry (100ms, 200ms, 300ms)
        await new Promise(r => setTimeout(r, 100 * retries));
      }
    }

    if (!success) {
      throw new Error("Mất kết nối với máy in hoặc máy in đang bận (GATT Error). Hãy thử tắt bật lại máy in.");
    }

    // TĂNG DELAY: Chờ máy in xử lý buffer trước khi gửi gói tiếp theo.
    // Tăng từ 20ms lên 50ms để ổn định hơn.
    await new Promise(r => setTimeout(r, 50));
  }
};

const CMD = {
  INIT: [0x1B, 0x40],
  CENTER: [0x1B, 0x61, 0x01],
  LEFT: [0x1B, 0x61, 0x00],
  BOLD_ON: [0x1B, 0x45, 0x01],
  BOLD_OFF: [0x1B, 0x45, 0x00],
  FEED: [0x0A],
  CUT: [0x1D, 0x56, 0x41, 0x00]
};

export const printBillBluetooth = async (bill: Bill) => {
  if (!printCharacteristic) throw new Error("Chưa kết nối máy in!");

  const encoder = new TextEncoder();
  const commands: number[] = [];

  const add = (...bytes: number[]) => commands.push(...bytes);
  const text = (str: string) => {
    const lines = wrapText(str, 32);
    lines.forEach((line, index) => {
      const cleanStr = removeAccents(line);
      const encoded = encoder.encode(cleanStr);
      encoded.forEach(b => commands.push(b));
      if (index < lines.length - 1) {
        nl();
      }
    });
  };
  const nl = () => add(0x0A);
  const textLR = (label: string, value: string) => {
    const lines = wrapLeftRight(label, value, 32);
    lines.forEach((line, index) => {
      text(line);
      if (index < lines.length - 1) {
        nl();
      }
    });
  };

  add(...CMD.INIT);

  add(...CMD.CENTER);
  add(...CMD.BOLD_ON);
  text("VNPT BAC BUON MA THUOT"); nl();
  add(...CMD.BOLD_OFF);
  text("Dia chi: 219 Ngo Quyen, Buon Ma Thuot, Dak Lak"); nl();
  text("--------------------------------"); nl();

  add(...CMD.BOLD_ON);
  text("THONG BAO CUOC"); nl();
  text(`Ky cuoc: ${bill.period}`); nl();
  add(...CMD.BOLD_OFF);
  nl();

  add(...CMD.LEFT);
  textLR("Ten KH:", bill.customerName); nl();
  if (bill.subscriberNumber) { textLR("So TB:", bill.subscriberNumber); nl(); }
  if (bill.paymentCode) { textLR("Ma TT:", bill.paymentCode); nl(); }
  if (bill.phone) { textLR("DT:", bill.phone); nl(); }
  textLR("Dia chi:", bill.address); nl();

  add(...CMD.CENTER);
  text("--------------------------------"); nl();

  add(...CMD.LEFT);

  textLR("TONG CONG:", `${bill.total.toLocaleString('vi-VN')} d`); nl();


  text(`${numberToWordsNoAccent(bill.total)}`); nl();

  text("(Da bao gom VAT)"); nl();

  add(...CMD.CENTER);
  text("--------------------------------"); nl();
  add(...CMD.LEFT);
  textLR("", bill.staff.code); nl();
  text("--------------------------------");
  add(...CMD.CENTER);
  const now = new Date();
  const timeStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  textLR("Thoi gian:", timeStr); nl();
  text("--------------------------------"); nl();

  nl(); nl(); nl(); nl();

  await sendData(new Uint8Array(commands));
};

// Hàm in QR và thông tin thanh toán chuyển khoản
export const printPaymentQR = async (bill: Bill) => {
  if (!printCharacteristic) throw new Error("Chưa kết nối máy in!");

  const encoder = new TextEncoder();
  const commands: number[] = [];

  const add = (...bytes: number[]) => commands.push(...bytes);
  const text = (str: string) => {
    const lines = wrapText(str, 32);
    lines.forEach((line, index) => {
      const cleanStr = removeAccents(line);
      const encoded = encoder.encode(cleanStr);
      encoded.forEach(b => commands.push(b));
      if (index < lines.length - 1) {
        nl();
      }
    });
  };
  const nl = () => add(0x0A);
  const textLR = (label: string, value: string) => {
    const lines = wrapLeftRight(label, value, 32);
    lines.forEach((line, index) => {
      text(line);
      if (index < lines.length - 1) {
        nl();
      }
    });
  };

  add(...CMD.INIT);
  add(...CMD.CENTER);
  add(...CMD.BOLD_ON);
  text("HUONG DAN THANH TOAN"); nl();
  add(...CMD.BOLD_OFF);
  text("--------------------------------"); nl();

  add(...CMD.LEFT);
  textLR("KH:", bill.customerName); nl();
  textLR("Ky cuoc:", bill.period); nl();
  textLR("So tien:", `${bill.total.toLocaleString('vi-VN')} d`); nl();
  text("--------------------------------"); nl();

  add(...CMD.CENTER);
  text("CHUYEN KHOAN NGAN HANG"); nl();
  text("NGAN HANG: BIDV"); nl();
  text("STK: 8825006143"); nl();
  text("CHU TK: NGO TAN THONG"); nl();

  text("Noi dung CK: " + bill.customerName); nl();
  text("Luu y: Kiem tra ten TK truoc khi CK"); nl();

  text("--------------------------------"); nl();
  text("Khuyen mai: Dong 12 thang tang 1 thang"); nl();
  text("--------------------------------"); nl();
  add(...CMD.LEFT);
  textLR("NV ho tro:", bill.staff.code || "Nhan vien VNPT"); nl();

  nl(); nl(); nl(); nl();
  await sendData(new Uint8Array(commands));
};

// Hàm in phiếu báo hỏng
export const printFaultReport = async (bill: Bill) => {
  if (!printCharacteristic) throw new Error("Chưa kết nối máy in!");

  const encoder = new TextEncoder();
  const commands: number[] = [];

  const add = (...bytes: number[]) => commands.push(...bytes);
  const text = (str: string) => {
    const lines = wrapText(str, 32);
    lines.forEach((line, index) => {
      const cleanStr = removeAccents(line);
      const encoded = encoder.encode(cleanStr);
      encoded.forEach(b => commands.push(b));
      if (index < lines.length - 1) {
        nl();
      }
    });
  };
  const nl = () => add(0x0A);
  const textLR = (label: string, value: string) => {
    const lines = wrapLeftRight(label, value, 32);
    lines.forEach((line, index) => {
      text(line);
      if (index < lines.length - 1) {
        nl();
      }
    });
  };

  add(...CMD.INIT);

  // Header
  add(...CMD.CENTER);
  add(...CMD.BOLD_ON);
  text("VNPT BAC BUON MA THUOT"); nl();
  add(...CMD.BOLD_OFF);
  text("--------------------------------"); nl();

  // Title
  add(...CMD.BOLD_ON);
  text("PHIEU BAO HONG"); nl();
  add(...CMD.BOLD_OFF);
  nl();

  // Content
  add(...CMD.LEFT);
  textLR("KH:", bill.customerName); nl();
  textLR("Dia chi:", bill.address); nl();
  if (bill.subscriberNumber) { textLR("So TB:", bill.subscriberNumber); nl(); }
  if (bill.phone) { textLR("SDT:", bill.phone); nl(); }

  text("--------------------------------"); nl();

  // Note / Issue
  if (bill.note) {
    text(`Ghi chu: ${bill.note}`); nl();
  }
  text("Ly do: Bao hong dich vu mang/TV"); nl();
  nl();

  // Hotline Instruction (Important)
  add(...CMD.CENTER);
  add(...CMD.BOLD_ON);
  text("TONG DAI BAO HONG:"); nl();

  // Double height/width if possible, or just bold
  text("1800 1166"); nl();
  add(...CMD.BOLD_OFF);
  text("(Nhan phim 1 - Mien phi)"); nl();

  text("--------------------------------"); nl();

  // Footer
  add(...CMD.LEFT);
  textLR("NV ho tro:", bill.staff.code); nl();
  const now = new Date();
  const timeStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  textLR("Thoi gian:", timeStr); nl();

  nl(); nl(); nl(); nl();
  await sendData(new Uint8Array(commands));
};
