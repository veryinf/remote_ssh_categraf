import { Option, program } from 'commander';
import { NodeSSH } from 'node-ssh';

program.name('ssh-remote');
program.description('通过SSH连接远程服务器，获取运行指标数据，并输出为适合 categraf 使用的格式');
program.addOption(new Option('-h, --host <host>', '指定远程主机的地址').env('REMOTE_SSH_HOST').makeOptionMandatory(true));
program.addOption(
  new Option('-P, --port [port]', '连接端口, 默认22')
    .env('REMOTE_SSH_PORT')
    .argParser((v, p) => parseInt(v))
    .default(22),
);
program.addOption(new Option('-u, --username <username>', '连接用户名').env('REMOTE_SSH_USERNAME').makeOptionMandatory(true));
program.addOption(new Option('-p, --password <password>', '连接密码址').env('REMOTE_SSH_PASSWORD').makeOptionMandatory(true));
program.addOption(new Option('-l, --labels <labels...>', '指定指定上附加额外的标签格式为 <label>:<value>, 例如: monitor_id:1').env('REMOTE_SSH_LABELS'));
program.option('-d, --debug', '调试模式, 输出更多信息');
program.version('0.0.1', '-v, --version');
program.parse();
const argv = program.opts();
argv.labels = (argv.labels ?? []).flatMap((label: string) => {
  return label.includes(' ') ? label.split(' ') : [label];
});

const target = `${argv.host}:${argv.port}`;
const ssh = new NodeSSH();
let labels = '';
argv.labels.map((label: string) => {
  const [key, value] = label.split(':', 2);
  labels += `${key}="${value}",`;
});
labels += `target="${target}"`;

async function runMetrics() {
  try {
    await ssh.connect({
      host: argv.host,
      port: argv.port,
      username: argv.username,
      password: argv.password,
      readyTimeout: 5000,
      timeout: 5000,
    });
    console.log(`node_ssh_up{${labels}} 1`);
  } catch (error: any) {
    console.log(`node_ssh_up{${labels},msg="${escapeLables(error.toString())}"} 0`);
    ssh.dispose();
    return;
  }
  try {
    const basicText = await ssh.execCommand('(uname -r ; hostname ; uptime | awk -F "," \'{print $1}\' | sed  "s/ //g")');
    const basicPieces = basicText.stdout.split('\n', 3);
    console.log(`node_ssh_basic{${labels},version="${basicPieces[0]}",hostname="${basicPieces[1]}",uptime="${basicPieces[2]}"} 1`);

    const cpuText = await ssh.execCommand("LANG=C lscpu | awk -F: '$1==\"Model name\" {print $2}';awk '/processor/{core++} END{print core}' /proc/cpuinfo;uptime | sed 's/,/ /g' | awk '{for(i=NF-2;i<=NF;i++)print $i }' | xargs;vmstat 1 1 | awk 'NR==3{print $11}';vmstat 1 1 | awk 'NR==3{print $12}';vmstat 1 2 | awk 'NR==4{print $15}'");
    const cpuPieces = cpuText.stdout.split('\n', 6);
    console.log(`node_ssh_cpu_info{${labels},info="${cpuPieces[0]}"} 1`);
    console.log(`node_ssh_cpu_cores{${labels}} ${cpuPieces[1]}`);
    if (cpuPieces[2]) {
      const loadPieces = cpuPieces[2].split(' ', 3);
      console.log(`node_ssh_cpu_load_min1{${labels}} ${loadPieces[0]}`);
      console.log(`node_ssh_cpu_load_min5{${labels}} ${loadPieces[1]}`);
      console.log(`node_ssh_cpu_load_min15{${labels}} ${loadPieces[2]}`);
    }
    console.log(`node_ssh_cpu_interrupt{${labels}} ${cpuPieces[3]}`);
    console.log(`node_ssh_cpu_context_switch{${labels}} ${cpuPieces[4]}`);
    console.log(`node_ssh_cpu_usage{${labels}} ${100 - parseFloat(cpuPieces[5]!)}`);

    const memoryText = await ssh.execCommand('free -m | awk \'BEGIN{print "total used free buff_cache available"} NR==2{print $2,$3,$4,$6,$7}\'');
    const memoryLines = memoryText.stdout.split('\n', 2);
    const memoryPieces = memoryLines[1]!.split(' ', 5);
    console.log(`node_ssh_memory_total{${labels}} ${memoryPieces[0]}`);
    console.log(`node_ssh_memory_used{${labels}} ${memoryPieces[1]}`);
    console.log(`node_ssh_memory_free{${labels}} ${memoryPieces[2]}`);
    console.log(`node_ssh_memory_buff_cache{${labels}} ${memoryPieces[4]}`);
    console.log(`node_ssh_memory_available{${labels}} ${(parseFloat(cpuPieces[1]!) / parseFloat(memoryPieces[0]!)) * 100}`);

    const diskText = await ssh.execCommand("vmstat -D | awk 'NR==1{print $1}';vmstat -D | awk 'NR==2{print $1}';vmstat 1 1 | awk 'NR==3{print $10}';vmstat 1 1 | awk 'NR==3{print $9}';vmstat 1 1 | awk 'NR==3{print $16}'");
    const diskPieces = diskText.stdout.split('\n', 5);
    console.log(`node_ssh_disk_num{${labels}} ${diskPieces[0]}`);
    console.log(`node_ssh_disk_partition_num{${labels}} ${diskPieces[1]}`);
    console.log(`node_ssh_disk_block_write{${labels}} ${diskPieces[2]}`);
    console.log(`node_ssh_disk_block_read{${labels}} ${diskPieces[3]}`);
    console.log(`node_ssh_disk_write_rate{${labels}} ${diskPieces[4]}`);

    const interfaceText = await ssh.execCommand('cat /proc/net/dev | tail -n +3 | awk \'BEGIN{ print "interface_name receive_bytes transmit_bytes"} {print $1,$2,$10}\'');
    const interfaceLines = interfaceText.stdout.split('\n');
    for (let i = 1; i < interfaceLines.length; i++) {
      if (interfaceLines[i]) {
        const interfacePieces = interfaceLines[i]!.split(' ', 3);
        const interfaceName = interfacePieces[0]!.replace(':', '');
        console.log(`node_ssh_interface_receive_bytes{${labels},interface="${interfaceName}"} ${interfacePieces[1]}`);
        console.log(`node_ssh_interface_transmit_bytes{${labels},interface="${interfaceName}"} ${interfacePieces[2]}`);
      }
    }

    const fsText = await ssh.execCommand('df -mP | tail -n +2 | awk \'BEGIN{ print "filesystem used available usage mounted"} {print $1,$3,$4,$5,$6}\'');
    const fsLines = fsText.stdout.split('\n');
    for (let i = 1; i < fsLines.length; i++) {
      if (fsLines[i]) {
        const fsPieces = fsLines[i]!.split(' ', 5);
        console.log(`node_ssh_fs_used{${labels},filesystem="${fsPieces[0]}",mounted="${fsPieces[4]}"} ${fsPieces[1]}`);
        console.log(`node_ssh_fs_available{${labels},filesystem="${fsPieces[0]}",mounted="${fsPieces[4]}"} ${fsPieces[2]}`);
        console.log(`node_ssh_fs_usage{${labels},filesystem="${fsPieces[0]}",mounted="${fsPieces[4]}"} ${parseFloat(fsPieces[3]!)}`);
      }
    }

    const topCpuText = await ssh.execCommand('ps aux | sort -k3nr | awk \'BEGIN{ print "pid cpu_usage mem_usage command" } {printf "%s %s %s ", $2, $3, $4; for (i=11; i<=NF; i++) { printf "%s", $i; if (i < NF) printf " "; } print ""}\' | head -n 11');
    const topCpuLines = topCpuText.stdout.split('\n');
    for (let i = 1; i < topCpuLines.length; i++) {
      if (topCpuLines[i]) {
        const topCpuPieces = topCpuLines[i]!.split(' ', 4);
        console.log(`node_ssh_top_cpu_cpu_usage{${labels},pid="${topCpuPieces[0]}",command="${escapeLables(topCpuPieces[3]!)}"} ${topCpuPieces[1]}`);
        console.log(`node_ssh_top_cpu_mem_usage{${labels},pid="${topCpuPieces[0]}",command="${escapeLables(topCpuPieces[3]!)}"} ${topCpuPieces[2]}`);
      }
    }
    const topMemText = await ssh.execCommand('ps aux | sort -k4nr | awk \'BEGIN{ print "pid cpu_usage mem_usage command" } {printf "%s %s %s ", $2, $3, $4; for (i=11; i<=NF; i++) { printf "%s", $i; if (i < NF) printf " "; } print ""}\' | head -n 11');
    const topMemLines = topMemText.stdout.split('\n');
    for (let i = 1; i < topMemLines.length; i++) {
      if (topMemLines[i]) {
        const topMemPieces = topMemLines[i]!.split(' ', 4);
        console.log(`node_ssh_top_mem_cpu_usage{${labels},pid="${topMemPieces[0]}",command="${escapeLables(topMemPieces[3]!)}"} ${topMemPieces[1]}`);
        console.log(`node_ssh_top_mem_mem_usage{${labels},pid="${topMemPieces[0]}",command="${escapeLables(topMemPieces[3]!)}"} ${topMemPieces[2]}`);
      }
    }
  } catch (error: any) {
    console.log(`node_ssh_up{${labels},msg="${escapeLables(error.toString())}"} 2`);
  }
  ssh.dispose();
}

function escapeLables(text: string) {
  return text.replace(/\"/g, '\\"');
}

runMetrics();
