using System;
using System.ComponentModel;
using System.IO;
using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

public sealed class PerformanceFixtureLease : IDisposable
{
    private FileStream stream;
    private SafeFileHandle directoryHandle;

    public PerformanceFixtureLease(FileStream stream, SafeFileHandle directoryHandle)
    {
        this.stream = stream;
        this.directoryHandle = directoryHandle;
    }

    public void Dispose()
    {
        if (stream != null)
        {
            stream.Dispose();
            stream = null;
        }
        if (directoryHandle != null)
        {
            directoryHandle.Dispose();
            directoryHandle = null;
        }
    }
}

public static class PerformanceJobHost
{
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint INFINITE = 0xFFFFFFFF;
    private const uint WAIT_OBJECT_0 = 0x00000000;
    private const uint JOB_OBJECT_QUERY = 0x0004;
    private const uint JOB_OBJECT_ASSIGN_PROCESS = 0x0001;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    private const uint GENERIC_READ = 0x80000000;
    private const uint FILE_READ_ATTRIBUTES = 0x00000080;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFO
    {
        public uint cb;
        public IntPtr lpReserved;
        public IntPtr lpDesktop;
        public IntPtr lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public ushort wShowWindow;
        public ushort cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME
    {
        public uint LowDateTime;
        public uint HighDateTime;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BY_HANDLE_FILE_INFORMATION
    {
        public uint FileAttributes;
        public FILETIME CreationTime;
        public FILETIME LastAccessTime;
        public FILETIME LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        IntPtr securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(
        SafeFileHandle file,
        out BY_HANDLE_FILE_INFORMATION information);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(
        SafeFileHandle file,
        StringBuilder path,
        uint pathLength,
        uint flags);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenJobObject(uint desiredAccess, bool inheritHandle, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION information,
        uint informationLength
    );

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref STARTUPINFO startupInfo,
        out PROCESS_INFORMATION processInformation
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    private static Win32Exception Error(string operation)
    {
        return new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }

    private static string NormalizeFinalPath(string path)
    {
        if (path.StartsWith("\\\\?\\UNC\\", StringComparison.OrdinalIgnoreCase))
        {
            return "\\\\" + path.Substring(8);
        }
        if (path.StartsWith("\\\\?\\", StringComparison.OrdinalIgnoreCase))
        {
            return path.Substring(4);
        }
        return path;
    }

    private static SafeFileHandle OpenVerifiedPath(string path, bool directory)
    {
        var expected = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar);
        var handle = CreateFile(
            expected,
            directory ? FILE_READ_ATTRIBUTES : GENERIC_READ,
            directory ? FILE_SHARE_READ | FILE_SHARE_WRITE : FILE_SHARE_READ,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | (directory ? FILE_FLAG_BACKUP_SEMANTICS : 0),
            IntPtr.Zero);
        if (handle.IsInvalid)
        {
            handle.Dispose();
            throw Error("CreateFile failed");
        }
        try
        {
            BY_HANDLE_FILE_INFORMATION information;
            if (!GetFileInformationByHandle(handle, out information))
            {
                throw Error("GetFileInformationByHandle failed");
            }
            if ((information.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
            {
                throw new IOException("performance fixture path must not be a reparse point");
            }
            bool isDirectory = (information.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
            if (isDirectory != directory)
            {
                throw new IOException("performance fixture path type changed");
            }

            var finalPath = new StringBuilder(32768);
            uint length = GetFinalPathNameByHandle(handle, finalPath, (uint)finalPath.Capacity, 0);
            if (length == 0 || length >= finalPath.Capacity)
            {
                throw Error("GetFinalPathNameByHandle failed");
            }
            var normalizedFinal = Path.GetFullPath(NormalizeFinalPath(finalPath.ToString()))
                .TrimEnd(Path.DirectorySeparatorChar);
            if (!String.Equals(expected, normalizedFinal, StringComparison.OrdinalIgnoreCase))
            {
                throw new IOException("performance fixture final path changed");
            }
            return handle;
        }
        catch
        {
            handle.Dispose();
            throw;
        }
    }

    private static void TerminateUnassignedProcess(IntPtr process, Exception cause)
    {
        if (!TerminateProcess(process, 1))
        {
            throw new AggregateException(cause, Error("TerminateProcess failed"));
        }
        if (WaitForSingleObject(process, INFINITE) != WAIT_OBJECT_0)
        {
            throw new AggregateException(cause, Error("WaitForSingleObject failed"));
        }
    }

    public static bool IsMember(string jobName, int processId)
    {
        IntPtr job = IntPtr.Zero;
        IntPtr process = IntPtr.Zero;
        try
        {
            job = OpenJobObject(JOB_OBJECT_QUERY, false, jobName);
            if (job == IntPtr.Zero) throw Error("OpenJobObject failed");
            process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, (uint)processId);
            if (process == IntPtr.Zero) throw Error("OpenProcess failed");
            bool result;
            if (!IsProcessInJob(process, job, out result)) throw Error("IsProcessInJob failed");
            return result;
        }
        finally
        {
            if (process != IntPtr.Zero) CloseHandle(process);
            if (job != IntPtr.Zero) CloseHandle(job);
        }
    }

    public static int Run(string executable, string workingDirectory, string jobName)
    {
        IntPtr job = IntPtr.Zero;
        PROCESS_INFORMATION process = new PROCESS_INFORMATION();
        bool processCreated = false;
        bool assigned = false;
        try
        {
            job = CreateJobObject(IntPtr.Zero, jobName);
            if (job == IntPtr.Zero) throw Error("CreateJobObject failed");

            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if (!SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                ref limits,
                (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))))
            {
                throw Error("SetInformationJobObject failed");
            }

            var startup = new STARTUPINFO();
            startup.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
            var commandLine = new StringBuilder("\"" + executable + "\"");
            if (!CreateProcess(
                executable,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                CREATE_SUSPENDED,
                IntPtr.Zero,
                workingDirectory,
                ref startup,
                out process))
            {
                throw Error("CreateProcess failed");
            }
            processCreated = true;

            if (!AssignProcessToJobObject(job, process.hProcess))
            {
                var assignmentError = Error("AssignProcessToJobObject failed");
                TerminateUnassignedProcess(process.hProcess, assignmentError);
                processCreated = false;
                throw assignmentError;
            }
            assigned = true;
            if (ResumeThread(process.hThread) == uint.MaxValue)
            {
                throw Error("ResumeThread failed");
            }

            Console.Out.WriteLine("{\"pid\":" + process.dwProcessId + "}");
            Console.Out.Flush();
            Console.In.ReadLine();
            if (!TerminateJobObject(job, 0)) throw Error("TerminateJobObject failed");
            WaitForSingleObject(process.hProcess, INFINITE);
            return 0;
        }
        finally
        {
            if (processCreated && !assigned) TerminateProcess(process.hProcess, 1);
            if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
            if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
            if (job != IntPtr.Zero) CloseHandle(job);
        }
    }

    public static PerformanceFixtureLease OpenFixtureAndHold(
        string executable,
        string workingDirectory,
        string jobName,
        string ownedRunDirectory,
        string fixturePath,
        string expectedSha256,
        long expectedByteSize)
    {
        if (fixturePath.IndexOf('"') >= 0 || fixturePath.IndexOf('\r') >= 0 || fixturePath.IndexOf('\n') >= 0)
        {
            throw new ArgumentException("fixture path contains an invalid command-line character");
        }

        SafeFileHandle directoryHandle = null;
        SafeFileHandle fixtureHandle = null;
        FileStream fixtureStream = null;
        IntPtr job = IntPtr.Zero;
        PROCESS_INFORMATION process = new PROCESS_INFORMATION();
        bool processCreated = false;
        bool assigned = false;
        try
        {
            var expectedDirectory = Path.GetFullPath(ownedRunDirectory)
                .TrimEnd(Path.DirectorySeparatorChar);
            var expectedFixtureDirectory = Path.GetDirectoryName(Path.GetFullPath(fixturePath))
                .TrimEnd(Path.DirectorySeparatorChar);
            if (!String.Equals(
                expectedDirectory,
                expectedFixtureDirectory,
                StringComparison.OrdinalIgnoreCase))
            {
                throw new IOException("performance fixture is outside the owned run directory");
            }
            directoryHandle = OpenVerifiedPath(expectedDirectory, true);
            fixtureHandle = OpenVerifiedPath(fixturePath, false);
            fixtureStream = new FileStream(fixtureHandle, FileAccess.Read);
            fixtureHandle = null;
            if (fixtureStream.Length != expectedByteSize)
            {
                throw new InvalidDataException("fixture byte size changed");
            }
            string actualSha256;
            using (var sha256 = SHA256.Create())
            {
                actualSha256 = BitConverter.ToString(sha256.ComputeHash(fixtureStream))
                    .Replace("-", "")
                    .ToLowerInvariant();
            }
            if (!String.Equals(actualSha256, expectedSha256, StringComparison.Ordinal))
            {
                throw new InvalidDataException("fixture content hash changed");
            }

            job = OpenJobObject(JOB_OBJECT_ASSIGN_PROCESS | JOB_OBJECT_QUERY, false, jobName);
            if (job == IntPtr.Zero) throw Error("OpenJobObject failed");

            var startup = new STARTUPINFO();
            startup.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
            var commandLine = new StringBuilder("\"" + executable + "\" \"" + fixturePath + "\"");
            if (!CreateProcess(
                executable,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                CREATE_SUSPENDED,
                IntPtr.Zero,
                workingDirectory,
                ref startup,
                out process))
            {
                throw Error("CreateProcess failed");
            }
            processCreated = true;

            if (!AssignProcessToJobObject(job, process.hProcess))
            {
                var assignmentError = Error("AssignProcessToJobObject failed");
                TerminateUnassignedProcess(process.hProcess, assignmentError);
                processCreated = false;
                throw assignmentError;
            }
            assigned = true;
            if (ResumeThread(process.hThread) == uint.MaxValue)
            {
                throw Error("ResumeThread failed");
            }
            WaitForSingleObject(process.hProcess, INFINITE);
            uint exitCode;
            if (!GetExitCodeProcess(process.hProcess, out exitCode))
            {
                throw Error("GetExitCodeProcess failed");
            }
            if (exitCode != 0)
            {
                throw new Win32Exception(unchecked((int)exitCode), "fixture sender failed");
            }
            var lease = new PerformanceFixtureLease(fixtureStream, directoryHandle);
            fixtureStream = null;
            directoryHandle = null;
            return lease;
        }
        finally
        {
            if (processCreated && !assigned) TerminateProcess(process.hProcess, 1);
            if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
            if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
            if (job != IntPtr.Zero) CloseHandle(job);
            if (fixtureStream != null) fixtureStream.Dispose();
            if (fixtureHandle != null) fixtureHandle.Dispose();
            if (directoryHandle != null) directoryHandle.Dispose();
        }
    }
}
